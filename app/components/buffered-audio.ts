import { compressedAudioCache } from "./compressed-audio-cache";
import { createOutput } from "./stream-output.client";
import {
  playbackContext,
  resumePlayback,
  transitionSeconds,
} from "./audio-context";
import {
  streamRate,
  streamChunkFrames,
  validStreamManifest,
  type StreamManifest,
} from "../domain/audio-stream";
import { download } from "./stream-download";

const sleep = (signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    signal.addEventListener("abort", abort, { once: true });
  });

/** A bounded, media-like streaming transport. Only the audio thread advances playback. */
export class BufferedAudio extends EventTarget {
  preload = "auto";
  readonly playbackRate = 1;
  paused = true;
  ended = false;
  seeking = false;
  error: Error | null = null;
  readyState = 0;
  private url = "";
  private manifest: StreamManifest | null = null;
  private offset = 0;
  private clock = 0;
  private running = false;
  private repeating = false;
  private boundary = false;
  private loops = 0;
  private node?: AudioWorkletNode;
  private normalization: GainNode;
  private envelope: GainNode;
  private request = new AbortController();
  private initialized: Promise<void> = Promise.resolve();
  private generation = 0;
  private attempt = 0;
  private loaded = new Set<number>();
  private pending = new Map<
    number,
    { request: AbortController; promise: Promise<void>; priority: number }
  >();
  private destroyed = false;
  private stopFollow?: () => void;
  private warmPosition?: number;
  private filling = false;

  constructor(
    private context = playbackContext(),
    private output = createOutput,
  ) {
    super();
    this.normalization = context.createGain();
    this.envelope = context.createGain();
    this.normalization.connect(this.envelope);
    this.envelope.connect(context.destination);
  }
  private emit(name: string) {
    this.dispatchEvent(new Event(name));
  }
  get duration() {
    return this.manifest ? this.manifest.frames / streamRate : 0;
  }
  get src() {
    return this.url;
  }
  set src(url: string) {
    this.url = url;
    this.load();
  }
  get loop() {
    return this.repeating;
  }
  set loop(value: boolean) {
    this.repeating = value;
    this.node?.port.postMessage({ type: "loop", value });
  }
  get currentTime() {
    if (this.boundary) return 0;
    const time =
      this.offset +
      (this.running && !this.paused && !this.seeking
        ? Math.max(0, this.context.currentTime - this.clock)
        : 0);
    return this.loop && this.duration
      ? time % this.duration
      : this.manifest
        ? Math.min(time, this.duration)
        : time;
  }
  set currentTime(position: number) {
    if (!Number.isFinite(position)) return;
    this.offset = Math.max(
      0,
      this.manifest ? Math.min(position, this.duration) : position,
    );
    void this.seek(this.offset, true).catch((error) => this.fail(error));
  }
  private asset(part: string) {
    const url = new URL(this.url, window.location.href);
    url.searchParams.set("stream", part);
    if (this.manifest) url.searchParams.set("revision", this.manifest.revision);
    return url.href;
  }
  load() {
    ++this.generation;
    ++this.attempt;
    this.request.abort();
    this.request = new AbortController();
    this.follow(null);
    this.clearOutput();
    this.manifest = null;
    this.offset = 0;
    this.running = false;
    this.paused = true;
    this.ended = false;
    this.error = null;
    this.readyState = 0;
    this.seeking = false;
    this.loops = 0;
    this.loaded.clear();
    this.pending.clear();
    this.initialized = Promise.resolve();
    this.emit("emptied");
    if (!this.url || this.destroyed) return;
    const signal = this.request.signal;
    this.emit("loadstart");
    this.initialized = (async () => {
      let response: Response;
      const deadline = performance.now() + 120_000;
      do {
        signal.throwIfAborted();
        response = await fetch(this.asset("manifest"), {
          signal,
          cache: "no-store",
        });
        if (response.status !== 202) break;
        if (performance.now() > deadline)
          throw new Error("Audio is still preparing. Try again shortly.");
        await sleep(signal);
      } while (true);
      if (!response.ok) throw new Error("Audio is unavailable.");
      const manifest: StreamManifest = await response.json();
      if (!validStreamManifest(manifest))
        throw new Error("Invalid audio description");
      const node = await this.output(this.context, manifest.channels);
      if (signal.aborted) {
        node.port.postMessage({ type: "dispose" });
        node.disconnect();
        signal.throwIfAborted();
      }
      this.node = node;
      this.manifest = manifest;
      node.connect(this.normalization);
      node.port.onmessage = (event) => this.report(event.data);
      node.port.postMessage({
        type: "configure",
        frames: manifest.frames,
        channels: manifest.channels,
      });
      node.port.postMessage({ type: "loop", value: this.loop });
      this.readyState = 1;
      this.emit("durationchange");
      this.emit("loadedmetadata");
    })();
    void this.initialized
      .then(() => {
        if (!signal.aborted) return this.seek(this.offset);
      })
      .catch((error) => {
        if (!signal.aborted) this.fail(error);
      });
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  private chunk(index: number, priority: number) {
    const manifest = this.manifest!;
    if (
      index < 0 ||
      index * streamChunkFrames >= manifest.frames ||
      this.loaded.has(index)
    )
      return Promise.resolve();
    const pending = this.pending.get(index);
    if (
      pending &&
      !pending.request.signal.aborted &&
      pending.priority <= priority
    )
      return pending.promise;
    pending?.request.abort();
    const request = new AbortController();
    const signal = AbortSignal.any([this.request.signal, request.signal]);
    const url = this.asset(String(index));
    const source = new URL(this.url, window.location.href).href;
    const generation = compressedAudioCache.generation;
    const compressed = !!(manifest.flacRate || manifest.mp3Rate);
    const promise = download(priority, signal, async () => {
      // Cached bytes still require the route's current permission/revision check.
      const cached = compressed ? compressedAudioCache.get(url) : undefined;
      const response = await fetch(url, {
        method: cached ? "HEAD" : "GET",
        signal,
        cache: "no-store",
      });
      if (!response.ok || response.status === 202)
        throw new Error("Audio is unavailable. Reload the player.");
      const encoded = cached ?? (await response.arrayBuffer());
      let bytes = compressed ? encoded.slice(0) : encoded;
      if (manifest.flacRate) {
        signal.throwIfAborted();
        const { decodeDemoFlac } = await import("./decode-demo-flac");
        bytes = await decodeDemoFlac(this.context, bytes, manifest, index);
      } else if (manifest.mp3Rate) {
        signal.throwIfAborted();
        const { decodeReleasePart } = await import("./decode-release-mp3");
        bytes = await decodeReleasePart(
          bytes,
          manifest,
          index,
          Number(response.headers.get("X-Wavecase-Sample-Offset") ?? NaN),
        );
      }
      signal.throwIfAborted();
      const frames = Math.min(
        streamChunkFrames,
        manifest.frames - index * streamChunkFrames,
      );
      if (bytes.byteLength !== frames * manifest.channels * 4)
        throw new Error("Incomplete audio part");
      if (compressed && !cached)
        compressedAudioCache.put(url, source, encoded, generation);
      this.node!.port.postMessage({ type: "chunk", index, bytes }, [bytes]);
      this.loaded.add(index);
      // Bound abandoned seek results as well as the normal moving window.
      const current = Math.floor(this.currentTime / 2);
      const evicted: number[] = [];
      for (const part of this.loaded) {
        if (this.loaded.size <= 18) break;
        if (part < 2 || part === current || part === current + 1) continue;
        this.loaded.delete(part);
        evicted.push(part);
      }
      if (evicted.length)
        this.node!.port.postMessage({ type: "evict", indices: evicted });
    }).finally(() => {
      if (this.pending.get(index)?.request === request)
        this.pending.delete(index);
    });
    this.pending.set(index, { request, promise, priority });
    return promise;
  }
  private prune(position: number, ahead = 10, evict = true) {
    const current = Math.floor(position / 2);
    const keep = (index: number) =>
      index < 2 ||
      (index >= Math.max(0, current - 2) && index <= current + ahead);
    const evicted = evict
      ? [...this.loaded].filter((index) => !keep(index))
      : [];
    for (const index of evicted) this.loaded.delete(index);
    for (const [index, item] of this.pending)
      if (!keep(index)) item.request.abort();
    if (evicted.length)
      this.node?.port.postMessage({ type: "evict", indices: evicted });
  }
  private async seek(position: number, userSeek = false) {
    const generation = ++this.generation;
    const signal = this.request.signal;
    this.seeking = true;
    this.emit("wavecase-user-seek");
    if (userSeek) this.emit("seeking");
    const index = Math.floor(position / 2);
    const immediate =
      this.loaded.has(index) &&
      (this.loaded.has(index + 1) || (index + 1) * 2 >= this.duration);
    if (!immediate) {
      this.running = false;
      this.node?.port.postMessage({ type: "pause", generation });
      if (!this.paused) this.emit("waiting");
    }
    try {
      await this.initialized;
    } catch (error) {
      if (generation !== this.generation || signal.aborted) return;
      throw error;
    }
    if (generation !== this.generation || signal.aborted) return;
    this.offset = Math.min(position, this.duration);
    this.prune(this.offset, 10, false);
    const target = Math.min(
      Math.floor(this.offset / 2),
      Math.ceil(this.duration / 2) - 1,
    );
    try {
      await Promise.all([this.chunk(target, 0), this.chunk(target + 1, 0)]);
    } catch (error) {
      if (generation !== this.generation || signal.aborted) return;
      throw error;
    }
    if (generation !== this.generation || signal.aborted) return;
    this.clock = this.context.currentTime;
    this.running = false;
    this.ended = false;
    this.seeking = false;
    this.readyState = 4;
    this.node!.port.postMessage({
      type: "seek",
      frame: Math.round(this.offset * streamRate),
      playing: !this.paused,
      generation,
      fade: immediate,
    });
    this.prune(this.offset);
    this.emit("seeked");
    this.emit("wavecase-user-seeked");
    this.emit("canplay");
    this.emit("timeupdate");
    this.fill();
  }
  play = async () => {
    if (this.destroyed || !this.url) return;
    if (this.error) {
      const position = this.offset;
      this.load();
      this.offset = position;
    }
    const attempt = ++this.attempt;
    const resumed = resumePlayback(this.context);
    if (this.paused) {
      this.paused = false;
      this.emit("play");
    }
    try {
      await Promise.all([resumed, this.initialized]);
      if (attempt !== this.attempt || this.paused) return;
      await this.seek(
        this.ended || this.offset >= this.duration ? 0 : this.currentTime,
      );
    } catch (error) {
      if (attempt === this.attempt) this.fail(error);
      throw error;
    }
  };
  pause = () => {
    ++this.attempt;
    this.offset = this.currentTime;
    this.running = false;
    const changed = !this.paused;
    this.paused = true;
    this.node?.port.postMessage({ type: "pause", generation: this.generation });
    if (changed) this.emit("pause");
  };
  setGain(db: number) {
    this.normalization.gain.setValueAtTime(
      10 ** (db / 20),
      this.context.currentTime,
    );
  }
  setAudible(audible: boolean, fade = false, now = this.context.currentTime) {
    const gain = this.envelope.gain;
    gain.cancelScheduledValues(now);
    if (fade) {
      gain.setValueAtTime(gain.value, now);
      gain.linearRampToValueAtTime(audible ? 1 : 0, now + transitionSeconds);
    } else gain.setValueAtTime(audible ? 1 : 0, now);
  }
  private report(state: {
    generation: number;
    frame: number;
    clock: number;
    playing: boolean;
    waiting: boolean;
    ended: boolean;
    loops: number;
  }) {
    if (state.generation !== this.generation || this.destroyed || this.seeking)
      return;
    const wasRunning = this.running;
    this.offset = state.frame / streamRate;
    this.clock = state.clock;
    this.running = state.playing && !state.waiting && !this.paused;
    if (state.loops > this.loops) {
      this.boundary = true;
      while (this.loops < state.loops) {
        this.loops++;
        this.emit("wavecase-loop");
      }
      this.boundary = false;
    }
    if (state.waiting && wasRunning) this.emit("waiting");
    if (this.running && !wasRunning) this.emit("playing");
    if (state.ended && !this.ended) {
      this.ended = true;
      this.paused = true;
      this.running = false;
      this.emit("timeupdate");
      this.emit("pause");
      this.emit("ended");
    } else this.emit("timeupdate");
    this.fill();
  }
  private ahead() {
    let index = Math.floor(this.currentTime / 2);
    while (this.loaded.has(index)) index++;
    return Math.min(this.duration, index * 2) - this.currentTime;
  }
  /** Keep the previous version's moving window ready only after active audio is safe. */
  follow(active: BufferedAudio | null) {
    this.stopFollow?.();
    this.stopFollow = undefined;
    this.warmPosition = undefined;
    if (!active) return;
    const update = () => {
      this.warmPosition =
        !active.paused && active.ahead() >= 8
          ? active.currentTime < this.duration
            ? active.currentTime
            : 0
          : undefined;
      if (this.warmPosition === undefined)
        for (const item of this.pending.values())
          if (item.priority === 2) item.request.abort();
      this.fill();
    };
    for (const name of ["timeupdate", "pause", "ended"])
      active.addEventListener(name, update);
    this.stopFollow = () => {
      for (const name of ["timeupdate", "pause", "ended"])
        active.removeEventListener(name, update);
    };
    update();
  }
  private fill() {
    if (!this.manifest || this.filling || this.seeking || this.error) return;
    const warm = this.warmPosition;
    if (this.paused && warm === undefined) return;
    const position = warm ?? this.currentTime;
    const first = Math.floor(position / 2);
    const ahead = warm === undefined ? 10 : 4;
    this.prune(position, ahead);
    const indices = [
      first,
      first + 1,
      first + 2,
      first + 3,
      0,
      1,
      ...Array.from(
        { length: Math.max(0, ahead - 3) },
        (_, i) => first + i + 4,
      ),
    ];
    const index = indices.find(
      (i) =>
        i * streamChunkFrames < this.manifest!.frames &&
        !this.loaded.has(i) &&
        !this.pending.has(i),
    );
    if (index === undefined) return;
    const signal = this.request.signal;
    this.filling = true;
    void this.chunk(index, warm === undefined ? 1 : 2)
      .catch((error) => {
        if (
          !signal.aborted &&
          !(error instanceof DOMException && error.name === "AbortError")
        )
          this.fail(error);
      })
      .finally(() => {
        this.filling = false;
        if (!signal.aborted) this.fill();
      });
  }
  private fail(error: unknown) {
    if (
      this.destroyed ||
      this.request.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      return;
    this.error =
      error instanceof Error ? error : new Error("Audio could not be loaded.");
    compressedAudioCache.forget(new URL(this.url, window.location.href).href);
    this.pause();
    this.request.abort();
    this.clearOutput();
    this.loaded.clear();
    this.emit("error");
  }
  private clearOutput() {
    for (const item of this.pending.values()) item.request.abort();
    this.node?.port.postMessage({ type: "dispose" });
    if (this.node) this.node.port.onmessage = null;
    this.node?.disconnect();
    this.node = undefined;
  }
  destroy() {
    this.destroyed = true;
    this.src = "";
    this.normalization.disconnect();
    this.envelope.disconnect();
  }
}

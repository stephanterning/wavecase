import {
  loadPlaybackBuffer,
  playbackContext,
  resumePlayback,
  transitionSeconds,
} from "./audio-context";

type Voice = { source: AudioBufferSourceNode; gain: GainNode };

/** A small media-like transport with one audio clock. The actual sound is read
 * from decoded samples, never through Safari's delayed media-element bridge.
 * JS events update controls/analytics; they do not schedule repeat boundaries.
 */
export class BufferedAudio extends EventTarget {
  preload = "auto";
  readonly playbackRate = 1;
  paused = true;
  ended = false;
  seeking = false;
  error: Error | null = null;
  readyState = 0;
  private url = "";
  private buffer: AudioBuffer | null = null;
  private offset = 0;
  private startedAt = 0;
  private repeating = false;
  private loops = 0;
  private boundary = false;
  private voice: Voice | null = null;
  private voices = new Set<Voice>();
  private normalization: GainNode;
  private envelope: GainNode;
  private timer?: ReturnType<typeof setInterval>;
  private request?: AbortController;
  private loaded: Promise<void> = Promise.resolve();
  private attempt = 0;
  private destroyed = false;

  constructor(
    private context = playbackContext(),
    private loadBuffer = loadPlaybackBuffer,
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
    return this.buffer?.duration ?? 0;
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
    const position = this.currentTime;
    this.repeating = value;
    this.offset = position;
    this.startedAt = this.context.currentTime;
    this.loops = 0;
    if (this.voice) this.voice.source.loop = value;
  }
  get currentTime() {
    if (this.boundary) return 0;
    const time =
      this.offset +
      (this.voice && !this.paused
        ? this.context.currentTime - this.startedAt
        : 0);
    return this.loop && this.duration
      ? time % this.duration
      : this.buffer
        ? Math.min(time, this.duration)
        : time;
  }
  set currentTime(position: number) {
    if (!Number.isFinite(position)) return;
    this.tick();
    this.emit("wavecase-user-seek");
    this.offset = Math.max(
      0,
      this.buffer ? Math.min(position, this.duration) : position,
    );
    this.startedAt = this.context.currentTime;
    this.loops = 0;
    this.ended = false;
    this.seeking = true;
    this.emit("seeking");
    if (this.voice && !this.paused) this.startVoice(true);
    this.seeking = false;
    this.emit("seeked");
    this.emit("timeupdate");
    this.emit("wavecase-user-seeked");
  }

  load() {
    ++this.attempt;
    this.request?.abort();
    this.stopVoices();
    this.paused = true;
    this.ended = false;
    this.error = null;
    this.readyState = 0;
    this.buffer = null;
    this.offset = 0;
    this.loops = 0;
    this.loaded = Promise.resolve();
    this.emit("emptied");
    if (!this.url || this.destroyed) return;
    const request = new AbortController();
    this.request = request;
    this.emit("loadstart");
    this.loaded = this.loadBuffer(this.context, this.url, request.signal)
      .then((buffer) => {
        request.signal.throwIfAborted();
        this.buffer = buffer;
        this.offset = Math.min(this.offset, buffer.duration);
        this.readyState = 4;
        this.emit("durationchange");
        this.emit("loadedmetadata");
        this.emit("canplay");
      })
      .catch((error) => {
        if (!request.signal.aborted) {
          this.error =
            error instanceof Error
              ? error
              : new Error("Audio could not be loaded.");
          this.paused = true;
          this.emit("error");
        }
        throw error;
      });
    // Preloading without a play request must not produce an unhandled rejection.
    void this.loaded.catch(() => {});
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }

  play = async () => {
    if (this.destroyed || !this.url) return;
    const attempt = ++this.attempt;
    const resumed = resumePlayback(this.context); // Preserve the user gesture.
    if (this.paused) {
      this.paused = false;
      this.emit("play");
    }
    try {
      await Promise.all([resumed, this.loaded]);
    } catch (error) {
      if (attempt === this.attempt) this.pause();
      throw error;
    }
    if (attempt !== this.attempt || this.paused || !this.buffer) return;
    if (this.voice) return;
    if (this.offset >= this.duration) this.offset = 0;
    this.ended = false;
    this.startVoice(false);
    this.emit("playing");
  };
  pause = () => {
    ++this.attempt;
    if (this.paused) return;
    this.tick();
    this.offset = this.currentTime;
    this.paused = true;
    if (this.voice) this.retire(this.voice, true);
    this.voice = null;
    clearInterval(this.timer);
    this.timer = undefined;
    this.emit("pause");
  };
  setGain(db: number) {
    this.normalization.gain.setValueAtTime(
      10 ** (db / 20),
      this.context.currentTime,
    );
  }
  setAudible(audible: boolean, fade = false, now = this.context.currentTime) {
    this.envelope.gain.cancelScheduledValues(now);
    if (fade) {
      this.envelope.gain.setValueAtTime(this.envelope.gain.value, now);
      this.envelope.gain.linearRampToValueAtTime(
        audible ? 1 : 0,
        now + transitionSeconds,
      );
    } else this.envelope.gain.setValueAtTime(audible ? 1 : 0, now);
  }

  private startVoice(fade: boolean) {
    if (!this.buffer) return;
    const now = this.context.currentTime;
    if (this.voice) this.retire(this.voice, fade, now);
    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    const voice = { source, gain };
    source.buffer = this.buffer;
    source.loop = this.loop;
    source.connect(gain);
    gain.connect(this.normalization);
    gain.gain.setValueAtTime(fade ? 0 : 1, now);
    if (fade) gain.gain.linearRampToValueAtTime(1, now + transitionSeconds);
    this.voice = voice;
    this.voices.add(voice);
    this.startedAt = now;
    this.loops = 0;
    source.onended = () => {
      this.releaseVoice(voice);
      if (this.voice !== voice) return;
      this.voice = null;
      this.offset = this.duration;
      this.paused = true;
      this.ended = true;
      clearInterval(this.timer);
      this.timer = undefined;
      this.emit("timeupdate");
      this.emit("pause");
      this.emit("ended");
    };
    source.start(now, this.offset);
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 50);
  }
  private tick() {
    if (!this.voice || this.paused) return;
    if (this.loop && this.duration) {
      const cycles = Math.floor(
        (this.offset + this.context.currentTime - this.startedAt) /
          this.duration,
      );
      while (this.loops < cycles) {
        this.loops++;
        // Late UI timers still close each complete loop at the correct boundary.
        this.boundary = true;
        this.emit("wavecase-loop");
        this.boundary = false;
      }
    }
    this.emit("timeupdate");
  }
  private releaseVoice(voice: Voice) {
    voice.source.disconnect();
    voice.gain.disconnect();
    this.voices.delete(voice);
  }
  private retire(voice: Voice, fade: boolean, now = this.context.currentTime) {
    voice.source.onended = () => this.releaseVoice(voice);
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    if (fade)
      voice.gain.gain.linearRampToValueAtTime(0, now + transitionSeconds);
    voice.source.stop(now + (fade ? transitionSeconds : 0));
    if (!fade) this.releaseVoice(voice);
  }
  private stopVoices() {
    clearInterval(this.timer);
    this.timer = undefined;
    this.voice = null;
    for (const voice of this.voices) this.retire(voice, false);
  }
  destroy() {
    this.destroyed = true;
    this.src = "";
    this.normalization.disconnect();
    this.envelope.disconnect();
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { BufferedAudio } from "../app/components/buffered-audio";
import { createPlaybackMedia } from "../app/components/playback-audio";

class Param {
  value = 1;
  ramps: [number, number][] = [];
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.value = value;
    this.ramps.push([value, time]);
  }
}
class Node {
  gain = new Param();
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  starts: number[][] = [];
  stops: number[] = [];
  disconnected = false;
  connect() {}
  disconnect() {
    this.disconnected = true;
  }
  start(...args: number[]) {
    this.starts.push(args);
  }
  stop(time: number) {
    this.stops.push(time);
  }
}
class Context {
  currentTime = 0;
  sampleRate = 48000;
  state = "running";
  destination = new Node();
  voices: Node[] = [];
  gains: Node[] = [];
  resume = async () => {
    this.state = "running";
  };
  createGain() {
    const node = new Node();
    this.gains.push(node);
    return node;
  }
  createBufferSource() {
    const node = new Node();
    this.voices.push(node);
    return node;
  }
}
const buffer = { duration: 10 } as AudioBuffer;
const settle = () => new Promise<void>((resolve) => queueMicrotask(resolve));

test("buffered seeking schedules a replacement on the audio clock with at most 5 ms overlap", async () => {
  const context = new Context();
  const audio = new BufferedAudio(
    context as unknown as AudioContext,
    async () => buffer,
  );
  audio.src = "/audio";
  await audio.play();
  context.currentTime = 2;
  assert.equal(audio.currentTime, 2);
  audio.currentTime = 7;
  assert.equal(audio.currentTime, 7);
  assert.deepEqual(context.voices[1].starts, [[2, 7]]);
  assert.deepEqual(context.voices[0].stops, [2.005]);
  assert.deepEqual(context.gains[2].gain.ramps.at(-1), [0, 2.005]);
  assert.deepEqual(context.gains[3].gain.ramps.at(-1), [1, 2.005]);
  context.voices[0].onended?.();
  assert.equal(
    audio.paused,
    false,
    "retired source cannot end its replacement",
  );
  context.currentTime = 3;
  audio.pause();
  assert.equal(audio.currentTime, 8);
  context.currentTime = 5;
  await audio.play();
  assert.deepEqual(context.voices.at(-1)?.starts, [[5, 8]]);
  context.voices.at(-1)?.onended?.();
  assert.equal(audio.ended, true);
  assert.equal(audio.currentTime, 10);
  await audio.play();
  assert.deepEqual(context.voices.at(-1)?.starts, [[5, 0]]);
  audio.destroy();
});

test("looping uses one continuous buffer source and late UI timers only report boundaries", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const context = new Context();
  const audio = new BufferedAudio(
    context as unknown as AudioContext,
    async () => buffer,
  );
  let loops = 0;
  audio.addEventListener("wavecase-loop", () => {
    loops++;
    assert.equal(audio.currentTime, 0);
  });
  audio.loop = true;
  audio.src = "/audio";
  await audio.play();
  context.currentTime = 31;
  assert.equal(audio.currentTime, 1);
  assert.equal(context.voices.length, 1);
  assert.equal(context.voices[0].loop, true);
  t.mock.timers.tick(50);
  assert.equal(loops, 3);
  audio.currentTime = 0;
  t.mock.timers.tick(50);
  assert.equal(loops, 3, "a backward user seek is not a repeat");
  audio.loop = false;
  assert.equal(context.voices.at(-1)?.loop, false);
  audio.destroy();
});

test("pause, replacement and disposal cancel pending playback without retaining stale buffers", async () => {
  const context = new Context();
  const loads: {
    signal: AbortSignal;
    resolve: (buffer: AudioBuffer) => void;
  }[] = [];
  const audio = new BufferedAudio(
    context as unknown as AudioContext,
    (_context, _url, signal) =>
      new Promise((resolve) => loads.push({ signal, resolve })),
  );
  audio.src = "/first";
  const first = audio.play();
  audio.pause();
  loads[0].resolve(buffer);
  await first;
  assert.equal(context.voices.length, 0);
  audio.src = "/second";
  const second = audio.play();
  audio.src = "/third";
  const third = audio.play();
  assert.equal(loads[1].signal.aborted, true);
  loads[1].resolve(buffer);
  await assert.rejects(second, { name: "AbortError" });
  loads[2].resolve(buffer);
  await third;
  assert.equal(context.voices.length, 1);
  assert.equal(audio.paused, false);
  audio.destroy();
  assert.equal(audio.duration, 0);
  assert.equal(loads[2].signal.aborted, true);
  assert.ok(context.voices.every((voice) => voice.disconnected));
});

test("loading and resume failures can be retried and never leave silent playback marked active", async () => {
  const context = new Context();
  let fail = true;
  const audio = new BufferedAudio(
    context as unknown as AudioContext,
    async () => {
      if (fail) throw new Error("Download failed");
      return buffer;
    },
  );
  audio.src = "/audio";
  await assert.rejects(audio.play(), /Download failed/);
  assert.equal(audio.paused, true);
  fail = false;
  audio.load();
  await settle();
  context.state = "suspended";
  context.resume = async () => {
    throw new Error("Interrupted");
  };
  await assert.rejects(audio.play(), /Interrupted/);
  assert.equal(audio.paused, true);
  context.state = "running";
  await audio.play();
  assert.equal(audio.paused, false);
  audio.destroy();
});

test("six-minute stereo tracks use buffers; long files keep a streaming transport", (t) => {
  t.mock.method(
    globalThis,
    "setInterval",
    () => 0 as unknown as ReturnType<typeof setInterval>,
  );
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: Context,
  });
  class Streaming {}
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: Streaming,
  });
  t.after(() => {
    Reflect.deleteProperty(globalThis, "AudioContext");
    Reflect.deleteProperty(globalThis, "Audio");
  });
  const audio = createPlaybackMedia(360);
  assert.ok(audio instanceof BufferedAudio);
  audio.destroy();
  assert.ok(createPlaybackMedia(7200) instanceof Streaming);
  assert.ok(createPlaybackMedia(0) instanceof Streaming);
});

test("preparation serializes uncancellable decoding and discards superseded results", async (t) => {
  const { loadPlaybackBuffer, maxBufferBytes } =
    await import("../app/components/audio-context");
  const requests: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return new Response(new ArrayBuffer(8));
  });
  const decodes: ((buffer: AudioBuffer) => void)[] = [];
  const context = {
    decodeAudioData: () =>
      new Promise<AudioBuffer>((resolve) => decodes.push(resolve)),
  } as unknown as AudioContext;
  const first = new AbortController();
  const abandoned = new AbortController();
  const next = new AbortController();
  const initial = loadPlaybackBuffer(context, "/first", first.signal);
  const cancelled = loadPlaybackBuffer(context, "/cancelled", abandoned.signal);
  const latest = loadPlaybackBuffer(context, "/latest", next.signal);
  const rejects = [
    assert.rejects(initial, { name: "AbortError" }),
    assert.rejects(cancelled, { name: "AbortError" }),
  ];
  while (!decodes.length) await settle();
  first.abort();
  abandoned.abort();
  assert.deepEqual(
    requests,
    ["/first"],
    "next download waits for the old decode",
  );
  const decoded = {
    duration: 360,
    length: 360 * 48000,
    numberOfChannels: 2,
  } as AudioBuffer;
  decodes[0](decoded);
  await Promise.all(rejects);
  while (decodes.length < 2) await settle();
  assert.deepEqual(requests, ["/first", "/latest"]);
  decodes[1](decoded);
  assert.equal(await latest, decoded);
  const oversized = loadPlaybackBuffer(context, "/oversized", next.signal);
  const tooLarge = assert.rejects(oversized, /memory budget/);
  while (decodes.length < 3) await settle();
  decodes[2]({ length: maxBufferBytes, numberOfChannels: 2 } as AudioBuffer);
  await tooLarge;
});

test("a seek during first loading is retained when playback starts", async () => {
  const context = new Context();
  let resolve!: (buffer: AudioBuffer) => void;
  const audio = new BufferedAudio(
    context as unknown as AudioContext,
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  audio.src = "/audio";
  const playing = audio.play();
  audio.currentTime = 7;
  assert.equal(audio.currentTime, 7);
  audio.loop = true;
  resolve(buffer);
  await playing;
  assert.deepEqual(context.voices[0].starts, [[0, 7]]);
  audio.destroy();
});

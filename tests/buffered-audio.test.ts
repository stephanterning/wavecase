import { test } from "node:test";
import assert from "node:assert/strict";
import { StreamRenderer } from "../app/components/stream-renderer";
import { streamChunkFrames, streamRate } from "../app/domain/audio-stream";
import { download } from "../app/components/stream-download";

function tone(index: number, frames = streamChunkFrames, frequency = 440) {
  const data = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    const sample =
      Math.sin(
        (2 * Math.PI * frequency * (index * streamChunkFrames + i)) /
          streamRate,
      ) * 0.5;
    data[i * 2] = sample;
    data[i * 2 + 1] = -sample;
  }
  return data;
}
function output(renderer: StreamRenderer, frames: number) {
  const channels = [new Float32Array(frames), new Float32Array(frames)];
  renderer.render(channels);
  return channels;
}

test("segment boundaries and repeats preserve every sample without main-thread scheduling", () => {
  const renderer = new StreamRenderer();
  renderer.frames = streamChunkFrames * 3 + 137;
  for (let i = 0; i < 4; i++)
    renderer.chunks.set(i, tone(i, i === 3 ? 137 : undefined));
  renderer.loop = true;
  renderer.seek(0, true, 1, false);
  // A long block simulates an audio thread continuing while the page is busy.
  const channels = output(renderer, renderer.frames * 2 + 100);
  for (let i = 0; i < channels[0].length; i++) {
    const frame = i % renderer.frames;
    const index = Math.floor(frame / streamChunkFrames);
    const expected =
      renderer.chunks.get(index)![(frame % streamChunkFrames) * 2];
    assert.equal(channels[0][i], expected);
    assert.equal(channels[1][i], -expected);
  }
  assert.equal(renderer.loops, 2);
  assert.equal(renderer.frame, 100);
});

test("ready seeks crossfade for exactly 5 ms and then contain only the new samples", () => {
  const renderer = new StreamRenderer();
  renderer.frames = streamChunkFrames * 2;
  renderer.chunks.set(0, tone(0));
  renderer.chunks.set(1, tone(1, undefined, 880));
  renderer.seek(1000, true, 1, false);
  renderer.seek(streamChunkFrames + 1000, true, 2, true);
  const outgoing = renderer.chunks.get(0)!;
  renderer.chunks.delete(0); // Network cache eviction must not cut the ramp.
  const [channel] = output(renderer, 1000);
  const ramp = streamRate * 0.005;
  for (let i = 0; i < channel.length; i++) {
    const old = outgoing[(1000 + i) * 2];
    const next = renderer.chunks.get(1)![(1000 + i) * 2];
    const fraction = Math.max(0, (ramp - i) / ramp);
    assert.equal(
      channel[i],
      Math.fround(old * fraction + next * (1 - fraction)),
    );
  }
});

test("missing data holds the actual position and resumes at the exact unplayed sample", () => {
  const renderer = new StreamRenderer();
  renderer.frames = streamChunkFrames * 2;
  renderer.chunks.set(0, tone(0));
  renderer.seek(streamChunkFrames - 10, true, 1, false);
  const [first] = output(renderer, 128);
  assert.equal(renderer.frame, streamChunkFrames);
  assert.equal(renderer.waiting, true);
  assert.ok(first.slice(10).every((value) => value === 0));
  renderer.chunks.set(1, tone(1));
  const [next] = output(renderer, 128);
  assert.equal(renderer.waiting, false);
  assert.equal(renderer.frame, streamChunkFrames + 128);
  assert.equal(next[127], renderer.chunks.get(1)![127 * 2]);
  renderer.pause(2);
  output(renderer, 1000);
  assert.equal(
    renderer.frame,
    streamChunkFrames + 128,
    "pause never advances the timeline",
  );
});

test("end, replay and repeat-off retain the selected track's exact duration", () => {
  const renderer = new StreamRenderer();
  renderer.frames = 137;
  renderer.chunks.set(0, tone(0, 137));
  renderer.seek(0, true, 1, false);
  output(renderer, 256);
  assert.equal(renderer.ended, true);
  assert.equal(renderer.frame, 137);
  renderer.seek(0, true, 2, false);
  renderer.loop = true;
  output(renderer, 256);
  assert.equal(renderer.ended, false);
  assert.equal(renderer.loops, 1);
  renderer.loop = false;
  output(renderer, 256);
  assert.equal(renderer.ended, true);
});

test("speculative downloads leave a slot for playback and urgent work overtakes queued prefetch", async () => {
  const signal = new AbortController().signal;
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const job = (name: string, priority: number) =>
    download(priority, signal, () => {
      started.push(name);
      return new Promise((resolve) => finish.set(name, resolve));
    });
  const warm = job("warm", 2);
  const warmNext = job("warm-next", 2);
  const ahead = job("ahead", 1);
  const urgent = job("seek", 0);
  assert.deepEqual(started, ["warm", "ahead"]);
  finish.get("ahead")!();
  await ahead;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(started, ["warm", "ahead", "seek"]);
  finish.get("seek")!();
  finish.get("warm")!();
  await Promise.all([urgent, warm]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(started.at(-1), "warm-next");
  finish.get("warm-next")!();
  await warmNext;
});

test("mono samples retain their amplitude", () => {
  const renderer = new StreamRenderer();
  renderer.frames = 4;
  renderer.channels = 1;
  renderer.chunks.set(0, new Float32Array([0.2, -0.4, 1.1, -0.8]));
  renderer.seek(0, true, 1, false);
  const channel = new Float32Array(4);
  renderer.render([channel]);
  assert.deepEqual(channel, renderer.chunks.get(0));
});

test("repeat waits for audible beginning before counting a new play", () => {
  const renderer = new StreamRenderer();
  renderer.frames = streamChunkFrames + 137;
  renderer.chunks.set(1, tone(1, 137));
  renderer.loop = true;
  renderer.seek(renderer.frames - 10, true, 1, false);
  output(renderer, 256);
  assert.equal(renderer.loops, 0);
  assert.equal(renderer.frame, renderer.frames);
  assert.equal(renderer.waiting, true);
  renderer.chunks.set(0, tone(0));
  output(renderer, 128);
  assert.equal(renderer.loops, 1);
  assert.equal(renderer.frame, 128);
});

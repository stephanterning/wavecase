import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { processAudio } from "../app/server/audio";
const exec = promisify(execFile);
test("worker produces playable WAV, measurements, exact duration and waveform from high-resolution input", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-audio-"));
  try {
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=3:sample_rate=48000",
      "-c:a",
      "pcm_s24le",
      join(directory, "source.wav"),
    ]);
    const result = await processAudio(directory, "source.wav");
    assert.equal(result.metadata.samples, 144000);
    assert.equal(result.metadata.sampleRate, 48000);
    assert.equal(result.duration, 3);
    assert.equal(result.playback, "source.wav.wav");
    assert.equal(result.peaks.length, 300);
    assert.ok(result.peaks.every((v) => v > 0 && v < 1));
    assert.equal(typeof result.metadata.lufs, "number");
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      join(directory, result.playback),
    ]);
    const stream = JSON.parse(stdout).streams[0];
    assert.equal(stream.sample_rate, "44100");
    assert.equal(stream.bits_per_sample, 16);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("CAF PCM receives a real WAV derivative without upconversion or changing the original", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-caf-"));
  const { readFile } = await import("node:fs/promises");
  try {
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=1:sample_rate=22050",
      "-c:a",
      "pcm_s16le",
      join(directory, "source.caf"),
    ]);
    const original = await readFile(join(directory, "source.caf"));
    const result = await processAudio(directory, "source.caf");
    assert.equal(result.metadata.mime, "audio/wav");
    assert.notEqual(result.playback, "source.caf");
    assert.equal(
      (await readFile(join(directory, result.playback)))
        .subarray(0, 4)
        .toString(),
      "RIFF",
    );
    assert.deepEqual(await readFile(join(directory, "source.caf")), original);
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      join(directory, result.playback),
    ]);
    assert.equal(JSON.parse(stdout).streams[0].sample_rate, "22050");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

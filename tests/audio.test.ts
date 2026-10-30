import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat, readdir } from "node:fs/promises";
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
    assert.equal(result.playback, "source.wav");
    assert.equal(result.original, result.playback);
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
    assert.equal(stream.sample_rate, "48000");
    assert.equal(stream.bits_per_sample, 24);
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

async function probe(path: string) {
  const { stdout } = await exec("ffprobe", [
    "-v",
    "error",
    "-show_streams",
    "-of",
    "json",
    path,
  ]);
  return JSON.parse(stdout).streams[0];
}

for (const fixture of [
  {
    codec: "pcm_s32le",
    rate: 96000,
    extension: "wav",
    bits: 24,
    outRate: 48000,
  },
  {
    codec: "pcm_f32le",
    rate: 44100,
    extension: "wav",
    bits: 24,
    outRate: 44100,
  },
  {
    codec: "pcm_s16le",
    rate: 96000,
    extension: "wav",
    bits: 16,
    outRate: 48000,
  },
  { codec: "flac", rate: 44100, extension: "flac", bits: 16, outRate: 44100 },
  { codec: "alac", rate: 48000, extension: "m4a", bits: 16, outRate: 48000 },
  {
    codec: "pcm_s24be",
    rate: 48000,
    extension: "aiff",
    bits: 24,
    outRate: 48000,
  },
])
  test(`one master for ${fixture.codec} at ${fixture.rate} Hz`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-master-"));
    try {
      const key = "input." + fixture.extension;
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=duration=1:sample_rate=${fixture.rate}`,
        "-c:a",
        fixture.codec,
        join(directory, key),
      ]);
      const result = await processAudio(directory, key);
      const stream = await probe(join(directory, result.original));
      assert.equal(result.original, result.playback);
      assert.equal(result.metadata.wavDownload, true);
      assert.equal(Number(stream.sample_rate), fixture.outRate);
      assert.equal(stream.bits_per_sample, fixture.bits);
      assert.equal(result.metadata.samples, fixture.rate);
      assert.equal(result.duration, 1);
      // Publication, not processing, owns deletion of the upload.
      assert.ok((await stat(join(directory, key))).size > 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test("triangular dither reaches the actual 24-bit quantizer", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-dither-"));
  try {
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=mono",
      "-t",
      "1",
      "-c:a",
      "pcm_s32le",
      join(directory, "silence.wav"),
    ]);
    const result = await processAudio(directory, "silence.wav");
    const { stdout } = await exec(
      "ffmpeg",
      [
        "-v",
        "error",
        "-i",
        join(directory, result.original),
        "-f",
        "s32le",
        "-",
      ],
      { encoding: "buffer" },
    );
    const samples = Array.from({ length: stdout.length / 4 }, (_, i) =>
      stdout.readInt32LE(i * 4),
    );
    assert.ok(samples.some((v) => v === 0));
    assert.ok(samples.some((v) => v < 0));
    assert.ok(samples.every((v) => Math.abs(v) <= 256 && v % 256 === 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { encodeMp3 } from "../app/server/download";
import { removeAudioFiles } from "../app/server/audio-files";
for (const rate of [22050, 44100, 48000])
  test(`320 kbps MP3 at source rate ${rate}, cached and removed with its master`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-mp3-"));
    try {
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=duration=1:sample_rate=${rate}`,
        "-c:a",
        "pcm_s24le",
        join(directory, "master.wav"),
      ]);
      const key = await encodeMp3(directory, "master.wav");
      const stream = await probe(join(directory, key));
      assert.equal(stream.codec_name, "mp3");
      assert.equal(Number(stream.bit_rate), 320000);
      assert.equal(Number(stream.sample_rate), Math.max(rate, 32000));
      const before = await stat(join(directory, key));
      assert.equal(await encodeMp3(directory, "master.wav"), key);
      assert.equal((await stat(join(directory, key))).mtimeMs, before.mtimeMs);
      await removeAudioFiles(directory, ["master.wav", "master.wav"]);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

test("lossy uploads are playable but do not offer WAV export", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-lossy-"));
  try {
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=1",
      "-c:a",
      "libmp3lame",
      join(directory, "source.mp3"),
    ]);
    const before = await readFile(join(directory, "source.mp3"));
    const result = await processAudio(directory, "source.mp3");
    assert.equal(result.original, "source.mp3");
    assert.equal(result.metadata.wavDownload, false);
    assert.deepEqual(await readFile(join(directory, result.original)), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

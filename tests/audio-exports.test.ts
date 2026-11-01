import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  encodeWav,
  encodeFlac,
  probeDownload,
} from "../app/server/audio-exports";
import { removeAudioFiles } from "../app/server/audio-files";
const exec = promisify(execFile);

for (const [codec, rate] of [
  ["pcm_s24le", 96000],
  ["pcm_s16le", 48000],
  ["pcm_f32le", 44100],
] as const) {
  test(`${codec}/${rate}: WAV and FLAC have identical dithered 16/44.1 samples and preserve original`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-export-"));
    try {
      const source = join(directory, "source.wav");
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `anullsrc=r=${rate}:cl=stereo`,
        "-t",
        "0.2",
        "-c:a",
        codec,
        source,
      ]);
      const original = await readFile(source);
      const wav = await encodeWav(directory, "source.wav");
      const flac = await encodeFlac(directory, "source.wav");
      const decoded = [];
      for (const key of [wav, flac]) {
        const { probe } = await probeDownload(directory, key);
        assert.equal(Number(probe.streams[0].sample_rate), 44100);
        assert.equal(
          Number(
            probe.streams[0].bits_per_raw_sample ||
              probe.streams[0].bits_per_sample,
          ),
          16,
        );
        assert.equal(probe.streams[0].channels, 2);
        const { stdout } = await exec(
          "ffmpeg",
          ["-v", "error", "-i", join(directory, key), "-f", "s16le", "-"],
          { encoding: "buffer" },
        );
        assert.equal(stdout.length, 44100 * 0.2 * 2 * 2);
        const samples = Array.from({ length: stdout.length / 2 }, (_, i) =>
          stdout.readInt16LE(i * 2),
        );
        assert.ok(samples.some((v) => v === -1));
        assert.ok(samples.some((v) => v === 1));
        assert.ok(samples.some((v) => v === 0));
        assert.ok(samples.every((v) => Math.abs(v) <= 1));
        decoded.push(stdout);
      }
      assert.deepEqual(decoded[0], decoded[1]);
      assert.deepEqual(await readFile(source), original);
      const before = await stat(join(directory, flac));
      assert.equal(await encodeFlac(directory, "source.wav"), flac);
      assert.equal((await stat(join(directory, flac))).mtimeMs, before.mtimeMs);
      await removeAudioFiles(directory, ["source.wav"]);
      assert.deepEqual(await readdir(directory), []);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("16/44.1 audio is not dithered again and failed exports do not leave partial files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-export-"));
  try {
    const source = join(directory, "source.wav");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "0.2",
      "-c:a",
      "pcm_s16le",
      source,
    ]);
    assert.equal(await encodeWav(directory, "source.wav"), "source.wav");
    const flac = await encodeFlac(directory, "source.wav");
    const { stdout } = await exec(
      "ffmpeg",
      ["-v", "error", "-i", join(directory, flac), "-f", "s16le", "-"],
      { encoding: "buffer" },
    );
    assert.ok(stdout.every((byte) => byte === 0));
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=0.2:sample_rate=96000",
      "-c:a",
      "pcm_s24le",
      join(directory, "bad.wav"),
    ]);
    const bytes = await readFile(join(directory, "bad.wav"));
    await writeFile(
      join(directory, "bad.wav"),
      bytes.subarray(0, bytes.length - 12001),
    );
    await assert.rejects(encodeFlac(directory, "bad.wav"));
    assert.ok(
      (await readdir(directory)).every((key) => !key.startsWith("bad.wav.")),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

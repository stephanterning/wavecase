import { after, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, stat, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downloadDetails } from "../app/server/download-details";
import { formatDownloadDetails } from "../app/domain/download-details";
import { encodeMp3, encodeWav } from "../app/server/download";
import { pool } from "../app/server/db";
after(() => pool.end());

test("download estimates sum original files and artwork, show format ranges, and use cached exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "download-details-"));
  const audio = async (name: string, rate: number, codec: string) =>
    promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      `sine=duration=2:sample_rate=${rate}`,
      "-ac",
      "2",
      "-c:a",
      codec,
      join(directory, name),
    ]);
  try {
    await audio("one.wav", 44100, "pcm_s16le");
    await audio("two.wav", 48000, "pcm_s24le");
    await writeFile(join(directory, "cover.jpg"), Buffer.alloc(10000));
    const details = await downloadDetails(
      directory,
      ["one.wav", "two.wav"],
      "cover.jpg",
    );
    const originals =
      (await stat(join(directory, "one.wav"))).size +
      (await stat(join(directory, "two.wav"))).size;
    assert.ok(
      details.original.bytes! > originals + 10000 &&
        details.original.bytes! < originals + 30000,
    );
    assert.match(
      formatDownloadDetails(details.original),
      /16–24-bit · 44.1–48 kHz/,
    );
    assert.deepEqual(details.wav!.bitDepths, [16, 16]);
    assert.deepEqual(details.wav!.sampleRates, [44100, 44100]);
    assert.equal(details.flac!.bytes, null);
    assert.equal(details.mp3.bytes, 160000 + 10000 + 12288);
    assert.deepEqual(details.mp3.bitDepths, []);
    assert.deepEqual((await readdir(directory)).sort(), [
      "cover.jpg",
      "one.wav",
      "two.wav",
    ]);
    await encodeMp3(directory, "one.wav");
    const cached = await downloadDetails(directory, ["one.wav"], null);
    assert.equal(
      cached.mp3.bytes,
      (await stat(join(directory, "one.wav.mp3"))).size + 8192,
    );
    await audio("legacy.flac", 96000, "flac");
    const legacy = await downloadDetails(directory, ["legacy.flac"], null);
    assert.deepEqual(legacy.wav!.sampleRates, [44100]);
    assert.deepEqual(legacy.wav!.bitDepths, [16]);
    await encodeWav(directory, "legacy.flac");
    const prepared = await downloadDetails(directory, ["legacy.flac"], null);
    assert.equal(
      prepared.wav!.bytes,
      (await stat(join(directory, "legacy.flac.16-44100.wav"))).size + 8192,
    );
    await audio("lossy.mp3", 22050, "libmp3lame");
    const lossy = await downloadDetails(directory, ["lossy.mp3"], null);
    assert.equal(lossy.wav, null);
    assert.equal(lossy.flac, null);
    assert.ok(lossy.original.bytes! > 0);
    assert.deepEqual(lossy.mp3.sampleRates, [32000]);
    assert.equal(
      formatDownloadDetails({
        bytes: 47_123_456,
        bitDepths: [24],
        sampleRates: [48000],
      }),
      "~47.1 MB ZIP · 24-bit · 48 kHz",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  prepareStream,
  streamResponse,
  streamSuffix,
} from "../app/server/audio-stream";
import { removeAudioFiles } from "../app/server/audio-files";
import { flacWindow } from "../app/domain/demo-flac";

for (const [rate, channels, bits] of [
  [44100, 2, 24],
  [48000, 1, 16],
  [22050, 1, 8],
]) {
  test(`FLAC demo windows preserve ${bits}-bit samples at ${rate} Hz and replace a legacy cache`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "demo-flac-"));
    const key = "source.wav",
      file = join(dir, key),
      base = file + streamSuffix;
    const raw = bits === 8 ? "u8" : "s" + bits + "le";
    const codec = "pcm_" + raw;
    const ff = (...args: string[]) =>
      execFileSync("ffmpeg", ["-v", "error", ...args], {
        maxBuffer: 8 * 1024 * 1024,
      });
    try {
      ff(
        "-f",
        "lavfi",
        "-i",
        `anoisesrc=sample_rate=${rate}:duration=4.123:seed=17`,
        "-ac",
        String(channels),
        "-c:a",
        codec,
        file,
      );
      const reference = ff("-i", file, "-f", raw, "pipe:1");
      await writeFile(base + ".pcm", Buffer.alloc(8));
      await writeFile(
        base + ".json",
        JSON.stringify({
          revision: "a".repeat(64),
          sampleRate: 48000,
          channels: 1,
          frames: 2,
          chunkFrames: 96000,
        }),
      );
      const m = await prepareStream(dir, key);
      assert.equal(m.flacRate, rate);
      assert.equal(m.flacSamples, reference.length / (channels * (bits / 8)));
      await assert.rejects(stat(base + ".pcm"), { code: "ENOENT" });
      const request = (part: string) =>
        streamResponse(
          new Request(
            "http://localhost/media/id?stream=" +
              part +
              "&revision=" +
              m.revision,
            { headers: { "Accept-Encoding": "gzip" } },
          ),
          dir,
          key,
        );
      const wire = await (await request("manifest"))!.json();
      assert.equal(wire.flacEnds, undefined);
      for (const i of [2, 0, 1]) {
        const r = (await request(String(i)))!;
        assert.equal(r.headers.get("Content-Type"), "audio/flac");
        assert.equal(r.headers.get("Content-Encoding"), null);
        await writeFile(
          join(dir, "part.flac"),
          Buffer.from(await r.arrayBuffer()),
        );
        const { start, count } = flacWindow(rate, m.flacSamples!, i);
        const stride = (channels * bits) / 8;
        const decoded = ff("-i", join(dir, "part.flac"), "-f", raw, "pipe:1");
        assert.deepEqual(
          decoded.subarray(0, count * stride),
          reference.subarray(start * stride, (start + count) * stride),
        );
      }
      await removeAudioFiles(dir, [key]);
      await assert.rejects(readFile(base + ".flac"), { code: "ENOENT" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

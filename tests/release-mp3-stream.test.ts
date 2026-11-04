import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { MPEGDecoder } from "mpg123-decoder";
import { releaseMp3Response } from "../app/server/release-mp3-stream";
import { decodeReleasePart } from "../app/components/decode-release-mp3";

for (const channels of [1, 2])
  test(`Random ${channels}-channel MP3 windows reproduce continuous gapless decoding through joins and a partial tail`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "release-mp3-"));
    try {
      const key = "tone.mp3";
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "anoisesrc=sample_rate=48000:duration=9.123:seed=13",
        "-ac",
        String(channels),
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        join(dir, key),
      ]);
      const request = (query: string) =>
        releaseMp3Response(
          new Request("https://example.test/audio?" + query),
          dir,
          key,
        );
      const manifest = await (await request("stream=manifest"))!.json();
      assert.equal(manifest.frames, Math.round(9.123 * 48000));
      const decoder = new MPEGDecoder();
      await decoder.ready;
      const full = decoder.decode(await readFile(join(dir, key)));
      decoder.free();
      assert.equal(full.samplesDecoded, manifest.frames);
      for (const i of [4, 0, 2, 1, 3]) {
        const response = (await request(
          "stream=" + i + "&revision=" + manifest.revision,
        ))!;
        assert.equal(response.headers.get("Content-Type"), "audio/mpeg");
        const pcm = new Float32Array(
          await decodeReleasePart(
            await response.arrayBuffer(),
            manifest,
            i,
            Number(response.headers.get("X-Wavecase-Sample-Offset")),
          ),
        );
        for (let j = 0; j < pcm.length; j++) {
          const expected =
            full.channelData[j % channels][
              i * 96000 + Math.floor(j / channels)
            ];
          if (Math.abs(expected - pcm[j]) > 0.000004)
            assert.fail("MP3 window lost alignment at sample " + j);
        }
      }
      await assert.rejects(
        request("stream=0&revision=old"),
        (e: Response) => e.status === 409,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

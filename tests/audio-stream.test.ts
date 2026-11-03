import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prepareStream,
  streamResponse,
  streamSuffix,
} from "../app/server/audio-stream";
import { removeAudioFiles } from "../app/server/audio-files";
const exec = promisify(execFile);

test("stream parts reconstruct continuous 44.1-to-48 kHz decoding, including peaks above full scale", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-stream-"));
  try {
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "aevalsrc=1.25*sin(2*PI*440*t)|0.3*sin(2*PI*880*t):s=44100:d=4.013",
      "-c:a",
      "pcm_f32le",
      join(directory, "source.wav"),
    ]);
    const manifest = await prepareStream(directory, "source.wav");
    assert.equal(manifest.sampleRate, 48000);
    assert.equal(manifest.channels, 2);
    assert.ok(manifest.frames > 4 * 48000);
    const bytes: Buffer[] = [];
    for (let i = 0; i * manifest.chunkFrames < manifest.frames; i++) {
      const response = await streamResponse(
        new Request(
          "http://localhost/media/id?stream=" +
            i +
            "&revision=" +
            manifest.revision,
          { headers: { "Accept-Encoding": "gzip" } },
        ),
        directory,
        "source.wav",
      );
      assert.equal(response?.headers.get("Content-Encoding"), "gzip");
      assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
      bytes.push(
        await promisify(gunzip)(Buffer.from(await response!.arrayBuffer())),
      );
    }
    const all = Buffer.concat(bytes);
    assert.deepEqual(
      all,
      await readFile(join(directory, "source.wav" + streamSuffix + ".pcm")),
    );
    await exec("ffmpeg", [
      "-v",
      "error",
      "-i",
      join(directory, "source.wav"),
      "-ac",
      "2",
      "-af",
      "aresample=48000:filter_size=64",
      "-f",
      "f32le",
      join(directory, "reference.pcm"),
    ]);
    assert.deepEqual(all, await readFile(join(directory, "reference.pcm")));
    const samples = new Float32Array(
      all.buffer,
      all.byteOffset,
      all.byteLength / 4,
    );
    assert.ok(
      samples.some((sample) => sample > 1),
      "transport must not clip decoded peaks",
    );
    assert.deepEqual(
      await prepareStream(directory, "source.wav"),
      manifest,
      "prepared data is reusable",
    );
    for (const [query, status] of [
      ["stream=-1", 400],
      ["stream=1&revision=stale", 409],
      ["stream=100&revision=" + manifest.revision, 404],
    ] as const) {
      await assert.rejects(
        streamResponse(
          new Request("http://localhost/media/id?" + query),
          directory,
          "source.wav",
        ),
        (error: unknown) =>
          error instanceof Response && error.status === status,
      );
    }
    await exec("ffmpeg", [
      "-v",
      "error",
      "-i",
      join(directory, "source.wav"),
      "-af",
      "pan=mono|c0=c0",
      "-c:a",
      "pcm_f32le",
      join(directory, "mono.wav"),
    ]);
    const mono = await prepareStream(directory, "mono.wav");
    assert.equal(mono.channels, 1, "mono must not be remixed or attenuated");
    const monoBytes = await readFile(
      join(directory, "mono.wav" + streamSuffix + ".pcm"),
    );
    const monoSamples = new Float32Array(
      monoBytes.buffer,
      monoBytes.byteOffset,
      monoBytes.byteLength / 4,
    );
    for (let i = 0; i < monoSamples.length; i++)
      assert.equal(monoSamples[i], samples[i * 2]);
    await removeAudioFiles(directory, ["source.wav"]);
    await assert.rejects(
      stat(join(directory, "source.wav" + streamSuffix + ".pcm")),
      { code: "ENOENT" },
    );
    await assert.rejects(
      stat(join(directory, "source.wav" + streamSuffix + ".json")),
      { code: "ENOENT" },
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

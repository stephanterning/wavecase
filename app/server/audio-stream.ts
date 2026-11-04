import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";
import {
  streamRate,
  streamChunkFrames,
  validStreamManifest,
  type StreamManifest,
} from "../domain/audio-stream";

import { encodeFlacParts } from "./demo-flac";
import { flacPart, streamBase, streamFile, temporary } from "./storage-keys";
type Prepared = StreamManifest & {
  flacEnds?: number[];
  pcmCodecChecked?: boolean;
};
export async function streamManifest(
  directory: string,
  key: string,
): Promise<Prepared | null> {
  try {
    const manifest = JSON.parse(
      await readFile(join(directory, streamFile(key, "json")), "utf8"),
    );
    if (!validStreamManifest(manifest) || manifest.mp3Rate !== undefined)
      return null;
    if (manifest.flacRate) {
      const ends = manifest.flacEnds as number[] | undefined;
      if (
        !Array.isArray(ends) ||
        ends.length !== Math.ceil(manifest.frames / streamChunkFrames) ||
        !ends.every((n, i) => Number.isSafeInteger(n) && n > (ends[i - 1] ?? 0))
      )
        return null;
      const size = (await stat(join(directory, streamFile(key, "flac")))).size;
      return ends.at(-1) === size ? manifest : null;
    }
    if (manifest.flacEnds !== undefined) return null;
    const pcm = await stat(join(directory, streamFile(key, "pcm")));
    if (pcm.size !== manifest.frames * manifest.channels * 4) return null;
    return manifest;
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code === "ENOENT" ||
      error instanceof SyntaxError
    )
      return null;
    throw error;
  }
}

// Only integer masters use FLAC. Other playback files keep continuous float
// PCM so decoded peaks above full scale are not clipped or requantized.
export async function prepareStream(directory: string, key: string) {
  const existing = await streamManifest(directory, key);
  if (existing?.flacRate || existing?.pcmCodecChecked) return existing;
  const path = (kind: "json" | "pcm" | "flac") =>
    join(directory, streamFile(key, kind));
  const { stdout } = await promisify(execFile)(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-select_streams",
      "a:0",
      "-show_entries",
      "stream=codec_name,channels,sample_rate,duration_ts,time_base",
      "-of",
      "json",
      join(directory, key),
    ],
    { timeout: 120_000, maxBuffer: 4096 },
  );
  const stream = JSON.parse(stdout).streams[0];
  const channels = Number(stream?.channels);
  if (channels !== 1 && channels !== 2)
    throw new Error("Unsupported audio channels");
  const rate = Number(stream.sample_rate),
    samples = Number(stream.duration_ts);
  const flac =
    /^pcm_(?:u8|s(?:16|24)(?:le|be))$/.test(stream.codec_name) &&
    Number.isSafeInteger(rate) &&
    rate > 0 &&
    rate <= streamRate &&
    stream.time_base === "1/" + rate &&
    Number.isSafeInteger(samples) &&
    samples > 0;
  try {
    if (flac) {
      const flacEnds = await encodeFlacParts(
        join(directory, key),
        temporary(path("flac")),
        join(directory, flacPart(key)),
        rate,
        samples,
      );
      const manifest: Prepared = {
        revision: createHash("sha256")
          .update(streamBase(key) + "-flac-v1")
          .digest("hex"),
        frames: Math.ceil((samples * streamRate) / rate),
        sampleRate: streamRate,
        channels,
        chunkFrames: streamChunkFrames,
        flacRate: rate,
        flacSamples: samples,
        flacEnds,
      };
      await stat(join(directory, key));
      await rename(temporary(path("flac")), path("flac"));
      await writeFile(temporary(path("json")), JSON.stringify(manifest));
      await rename(temporary(path("json")), path("json"));
      await unlink(path("pcm")).catch((e) => {
        if (e.code !== "ENOENT") throw e;
      });
      return manifest;
    }
    if (existing) {
      existing.pcmCodecChecked = true;
      await writeFile(temporary(path("json")), JSON.stringify(existing));
      await rename(temporary(path("json")), path("json"));
      return existing;
    }
    await promisify(execFile)(
      "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-xerror",
        "-protocol_whitelist",
        "file,pipe",
        "-i",
        join(directory, key),
        "-map",
        "0:a:0",
        "-vn",
        "-af",
        "aresample=48000:filter_size=64",
        "-f",
        "f32le",
        temporary(path("pcm")),
      ],
      { timeout: 600_000, maxBuffer: 1024 * 1024 },
    );
    const size = (await stat(temporary(path("pcm")))).size;
    const frames = size / (channels * 4);
    if (!Number.isSafeInteger(frames) || frames <= 0)
      throw new Error("Empty prepared audio");
    // A deletion while preparing must not publish a new cache for that source.
    await stat(join(directory, key));
    const manifest: Prepared = {
      pcmCodecChecked: true,
      revision: createHash("sha256").update(streamBase(key)).digest("hex"),
      sampleRate: streamRate,
      channels,
      frames,
      chunkFrames: streamChunkFrames,
    };
    await rename(temporary(path("pcm")), path("pcm"));
    await writeFile(temporary(path("json")), JSON.stringify(manifest));
    await rename(temporary(path("json")), path("json"));
    return manifest;
  } finally {
    await Promise.all(
      (["pcm", "json", "flac"] as const).map((kind) =>
        unlink(temporary(path(kind))).catch(() => {}),
      ),
    );
  }
}

/** Call only after the existing route has authorized this exact playback key. */
export async function streamResponse(
  request: Request,
  directory: string,
  key: string,
) {
  const query = new URL(request.url).searchParams;
  const part = query.get("stream");
  if (part === null) return null;
  if (part !== "manifest" && !/^(0|[1-9]\d{0,8})$/.test(part))
    throw new Response("Invalid audio part", { status: 400 });
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  try {
    await stat(join(directory, key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new Response("Audio unavailable", { status: 404, headers });
    throw error;
  }
  const manifest = await streamManifest(directory, key);
  if (!manifest) {
    const { queue, boss } = await import("./queue");
    await queue();
    await boss.send(
      "prepare-stream",
      { key },
      { singletonKey: key, retryLimit: 3, retryDelay: 10 },
    );
    headers.set("Retry-After", "1");
    return new Response(null, { status: 202, headers });
  }
  if (part === "manifest") {
    return Response.json(
      { ...manifest, flacEnds: undefined, pcmCodecChecked: undefined },
      { headers },
    );
  }
  if (query.get("revision") !== manifest.revision)
    throw new Response("Audio changed. Reload the player.", {
      status: 409,
      headers,
    });
  const index = Number(part);
  const start = index * manifest.chunkFrames;
  if (start >= manifest.frames)
    throw new Response("Audio part not found", { status: 404, headers });
  headers.set(
    "Content-Type",
    manifest.flacRate ? "audio/flac" : "application/octet-stream",
  );
  if (request.method === "HEAD") return new Response(null, { headers });
  const offset = manifest.flacEnds
    ? (manifest.flacEnds[index - 1] ?? 0)
    : start * manifest.channels * 4;
  const length = manifest.flacEnds
    ? manifest.flacEnds[index] - offset
    : Math.min(manifest.chunkFrames, manifest.frames - start) *
      manifest.channels *
      4;
  const bytes = Buffer.alloc(length);
  const file = await open(
    join(directory, streamFile(key, manifest.flacRate ? "flac" : "pcm")),
    "r",
  );
  try {
    let read = 0;
    while (read < length) {
      const result = await file.read(bytes, read, length - read, offset + read);
      if (!result.bytesRead) throw new Error("Incomplete prepared audio");
      read += result.bytesRead;
    }
  } finally {
    await file.close();
  }
  if (
    !manifest.flacRate &&
    /\bgzip\b/.test(request.headers.get("accept-encoding") || "")
  ) {
    headers.set("Content-Encoding", "gzip");
    headers.set("Vary", "Accept-Encoding");
    return new Response(await promisify(gzip)(bytes, { level: 3 }), {
      headers,
    });
  }
  return new Response(bytes, { headers });
}

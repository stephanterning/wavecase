import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { streamChunkFrames, streamRate } from "../domain/audio-stream";

// Wavecase encodes MPEG-1 Layer III at 32, 44.1 or 48 kHz: 1152 samples/frame.
const samplesPerFrame = 1152;
const indexes = new Map<string, ReturnType<typeof indexFile>>();

async function indexFile(path: string, revision: string) {
  const { stdout } = await promisify(execFile)(
    "ffprobe",
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-f",
      "mp3",
      "-select_streams",
      "a:0",
      "-show_entries",
      "packet=pos,size:packet_side_data=skip_samples,discard_padding:stream=sample_rate,channels",
      "-of",
      "compact",
      path,
    ],
    { timeout: 60_000, maxBuffer: 32 * 1024 * 1024 },
  );
  const packets = [...stdout.matchAll(/^packet\|size=(\d+)\|pos=(\d+)(.*)$/gm)];
  const stream = stdout.match(/^stream\|sample_rate=(\d+)\|channels=([12])$/m);
  if (!packets.length || !stream) throw new Error("Invalid release MP3");
  const rate = Number(stream[1]);
  if (![32_000, 44_100, 48_000].includes(rate))
    throw new Error("Unsupported release MP3 rate");
  const skip = Number(packets[0][3].match(/skip_samples=(\d+)/)?.[1] ?? 0);
  const padding = Number(
    packets.at(-1)![3].match(/discard_padding=(\d+)/)?.[1] ?? 0,
  );
  const samples = packets.length * samplesPerFrame - skip - padding;
  if (samples <= 0) throw new Error("Empty release MP3");
  const frames = Math.ceil((samples * streamRate) / rate);
  const parts = Array.from(
    { length: Math.ceil(frames / streamChunkFrames) },
    (_, index) => {
      const target = index * 2 * rate + skip;
      // Pre-roll rebuilds the bit reservoir and synthesis history. Post-roll
      // supplies real neighbors for resampling at the far edge of the window.
      const first = Math.max(0, Math.floor(target / samplesPerFrame) - 12);
      const last = Math.min(
        packets.length - 1,
        Math.ceil((target + 2 * rate) / samplesPerFrame) + 2,
      );
      const start = Number(packets[first][2]);
      const length =
        Number(packets[last][2]) + Number(packets[last][1]) - start;
      return { start, length, offset: target - first * samplesPerFrame };
    },
  );
  return {
    manifest: {
      revision,
      sampleRate: streamRate,
      channels: Number(stream[2]),
      frames,
      chunkFrames: streamChunkFrames,
      mp3Rate: rate,
      mp3Samples: samples,
    },
    parts,
  };
}

/** The calling release route authorizes the track on each request. */
export async function releaseMp3Response(
  request: Request,
  directory: string,
  key: string,
) {
  const query = new URL(request.url).searchParams;
  const part = query.get("stream");
  if (part === null) return null;
  if (part !== "manifest" && !/^(0|[1-9]\d{0,8})$/.test(part))
    throw new Response("Invalid audio part", { status: 400 });
  const path = join(directory, key);
  const info = await stat(path).catch((error) => {
    if (error.code === "ENOENT")
      throw new Response("Audio unavailable", { status: 404 });
    throw error;
  });
  const revision = createHash("sha256")
    .update([path, info.size, info.mtimeMs].join("|"))
    .digest("hex");
  let pending = indexes.get(revision);
  if (!pending) {
    pending = indexFile(path, revision);
    indexes.set(revision, pending);
    if (indexes.size > 16) indexes.delete(indexes.keys().next().value!);
    void pending.catch(() => {
      if (indexes.get(revision) === pending) indexes.delete(revision);
    });
  }
  const { manifest, parts } = await pending;
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (part === "manifest") return Response.json(manifest, { headers });
  if (query.get("revision") !== revision)
    throw new Response("Audio changed", { status: 409, headers });
  const range = parts[Number(part)];
  if (!range)
    throw new Response("Audio part not found", { status: 404, headers });
  headers.set("Content-Type", "audio/mpeg");
  headers.set("X-Wavecase-Sample-Offset", String(range.offset));
  if (request.method === "HEAD") return new Response(null, { headers });
  const file = await open(path, "r");
  try {
    const bytes = Buffer.alloc(range.length);
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await file.read(
        bytes,
        read,
        bytes.length - read,
        range.start + read,
      );
      if (!bytesRead) throw new Error("Incomplete MP3 part");
      read += bytesRead;
    }
    return new Response(bytes, { headers });
  } finally {
    await file.close();
  }
}

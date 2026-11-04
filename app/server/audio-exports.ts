import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { playbackPlan } from "./audio-policy";
import { audioInput } from "./audio";

const encoding = new Map<string, Promise<string>>();

// Requests in this process share one encoder per export. Unique temporary names
// keep other processes apart; outputs are deterministic, so any rename is valid.
function cachedExport(
  directory: string,
  output: string,
  encode: (temporary: string) => Promise<unknown>,
) {
  const destination = join(directory, output);
  let pending = encoding.get(destination);
  if (!pending) {
    pending = (async () => {
      try {
        if ((await stat(destination)).size > 0) return output;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        await encode(temporary);
        if (!(await stat(temporary)).size)
          throw new Error("Empty audio output");
        await rename(temporary, destination);
        return output;
      } finally {
        await unlink(temporary).catch(() => {});
      }
    })().finally(() => encoding.delete(destination));
    encoding.set(destination, pending);
  }
  return pending;
}

export function encodeMp3(directory: string, key: string) {
  return cachedExport(directory, key + ".mp3", async (temporary) => {
    const { stdout } = await promisify(execFile)(
      "ffprobe",
      [
        "-v",
        "error",
        ...audioInput,
        "-select_streams",
        "a:0",
        "-show_entries",
        "stream=sample_rate",
        "-of",
        "json",
        join(directory, key),
      ],
      { timeout: 120000 },
    );
    const sourceRate = Number(JSON.parse(stdout).streams[0]?.sample_rate);
    const rate =
      sourceRate >= 48000 ? 48000 : sourceRate >= 44100 ? 44100 : 32000;
    await promisify(execFile)(
      "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-xerror",
        ...audioInput,
        "-i",
        join(directory, key),
        "-map",
        "0:a:0",
        "-vn",
        // MPEG-1 rates support 320 kb/s. Keep 44.1/48 kHz; lower sources use 32 kHz.
        "-af",
        `aresample=${rate}:filter_size=64`,
        "-c:a",
        "libmp3lame",
        "-b:a",
        "320k",
        "-compression_level",
        "2",
        "-f",
        "mp3",
        temporary,
      ],
      { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
    );
  });
}

export async function probeDownload(directory: string, key: string) {
  const { stdout } = await promisify(execFile)(
    "ffprobe",
    [
      "-v",
      "error",
      ...audioInput,
      "-select_streams",
      "a:0",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      join(directory, key),
    ],
    { timeout: 120000 },
  );
  const probe = JSON.parse(stdout);
  const audio = probe.streams[0];
  const plan = playbackPlan(
    audio.codec_name,
    Number(audio.sample_rate),
    Number(audio.bits_per_raw_sample) ||
      Number(audio.bits_per_sample) ||
      (/^pcm_f64/.test(audio.codec_name)
        ? 64
        : /^pcm_f32/.test(audio.codec_name)
          ? 32
          : 0),
    probe.format.format_name,
  );
  return { probe, plan };
}

// A separate cache name prevents reuse of older full-resolution WAV exports.
export const losslessSuffix = (format: "wav" | "flac") => `.16-44100.${format}`;

export function unchangedWav(
  probe: Awaited<ReturnType<typeof probeDownload>>["probe"],
) {
  const audio = probe.streams[0];
  return (
    probe.format.format_name === "wav" &&
    audio.codec_name === "pcm_s16le" &&
    Number(audio.sample_rate) === 44100
  );
}

export async function encodeWav(directory: string, key: string) {
  const { probe, plan } = await probeDownload(directory, key);
  if (!plan.wavDownload)
    throw new Response("Download format unavailable", { status: 400 });
  if (unchangedWav(probe)) return key;
  const audio = probe.streams[0];
  const bits =
    Number(audio.bits_per_raw_sample) || Number(audio.bits_per_sample);
  // Resampling creates fractional samples even when the input is already 16-bit.
  const dither =
    !bits ||
    bits > 16 ||
    /^pcm_f/.test(audio.codec_name) ||
    Number(audio.sample_rate) !== 44100;
  return cachedLossless(directory, key, "wav", key, [
    "-af",
    `${dither ? "aformat=sample_fmts=dbl," : ""}aresample=44100:filter_size=64:output_sample_bits=16:dither_method=${dither ? "triangular" : "none"}`,
    "-c:a",
    "pcm_s16le",
  ]);
}

export async function encodeFlac(directory: string, key: string) {
  // Encode the exact WAV samples, with no second quantization or dither pass.
  const wav = await encodeWav(directory, key);
  return cachedLossless(directory, key, "flac", wav, [
    "-c:a",
    "flac",
    "-sample_fmt",
    "s16",
  ]);
}

function cachedLossless(
  directory: string,
  key: string,
  format: "wav" | "flac",
  source: string,
  options: string[],
) {
  return cachedExport(directory, key + losslessSuffix(format), (temporary) =>
    promisify(execFile)(
      "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-xerror",
        ...audioInput,
        "-i",
        join(directory, source),
        "-map",
        "0:a:0",
        "-vn",
        ...options,
        "-f",
        format,
        temporary,
      ],
      { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
    ),
  );
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { playbackPlan } from "./audio-policy";
import { releaseTracks, versions } from "./schema";
import { audioInput } from "./audio";

export async function encodeMp3(directory: string, key: string) {
  const destination = join(directory, key + ".mp3");
  try {
    if ((await stat(destination)).size > 0) return key + ".mp3";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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
  const temporary = destination + ".tmp";
  try {
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
    if (!(await stat(temporary)).size) throw new Error("Empty MP3 output");
    await rename(temporary, destination);
    return key + ".mp3";
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

async function probeDownload(directory: string, key: string) {
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

export async function demoWavAvailable(
  version: {
    original: string | null;
    metadata: Record<string, unknown> | null;
  },
  directory: string,
) {
  if (!version.original) return false;
  if (version.metadata?.audioPolicy === 2)
    return version.metadata.wavDownload === true;
  return (await probeDownload(directory, version.original)).plan.wavDownload;
}

export async function encodeWav(directory: string, key: string) {
  const { probe, plan } = await probeDownload(directory, key);
  if (!plan.wavDownload)
    throw new Response("Download format unavailable", { status: 400 });
  // Keep existing PCM WAV originals byte-for-byte, including legacy masters.
  if (
    probe.format.format_name === "wav" &&
    /^pcm_[suf]\d/.test(probe.streams[0].codec_name)
  )
    return key;
  const destination = join(directory, key + ".export.wav");
  try {
    if ((await stat(destination)).size > 0) return key + ".export.wav";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = destination + ".tmp";
  try {
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
        "-af",
        `${plan.dither ? "aformat=sample_fmts=dbl," : ""}aresample=${plan.sampleRate}:filter_size=64:output_sample_bits=${plan.codec === "pcm_s24le" ? 24 : plan.codec === "pcm_s16le" ? 16 : 8}:dither_method=${plan.dither ? "triangular" : "none"}`,
        "-c:a",
        plan.codec,
        "-f",
        "wav",
        temporary,
      ],
      { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
    );
    if (!(await stat(temporary)).size) throw new Error("Empty WAV output");
    await rename(temporary, destination);
    return key + ".export.wav";
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function releaseMp3Download(
  trackId: string,
  original: string,
  directory: string,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(releaseTracks)
      .where(eq(releaseTracks.id, trackId))
      .for("update");
    if (current?.original !== original || !current.playback)
      throw new Response("Audio changed. Please try again.", { status: 409 });
    return encodeMp3(directory, original);
  });
}

export async function demoAudioDownload(
  versionId: string,
  original: string,
  directory: string,
  format: "wav" | "mp3",
) {
  // Serialize encoding across web processes and coordinate with replacement/removal.
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .for("update");
    if (current?.original !== original || current.state !== "ready")
      throw new Response("Audio changed. Please try again.", { status: 409 });
    if (format === "wav") {
      if (!(await demoWavAvailable(current, directory)))
        throw new Response("Download format unavailable", { status: 400 });
      return encodeWav(directory, original);
    }
    return encodeMp3(directory, original);
  });
}

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { playbackPlan } from "./audio-policy";
const exec = promisify(execFile);
const formats = "wav,aiff,flac,mp3,mov,matroska,ogg,aac,asf,ape,wv,au,caf";
export const audioInput = [
  "-protocol_whitelist",
  "file,pipe",
  "-format_whitelist",
  formats,
];
export async function processAudio(directory: string, key: string) {
  const source = join(directory, key);
  const { stdout } = await exec(
    "ffprobe",
    [
      "-v",
      "error",
      ...audioInput,
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      source,
    ],
    { timeout: 120000 },
  );
  const probe = JSON.parse(stdout);
  if (
    Number(probe.format.duration) >
    Number(process.env.MAX_DURATION_SECONDS || 7200)
  )
    throw new Error("Audio exceeds the configured duration limit");
  const audio = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  if (!audio || audio.channels < 1 || audio.channels > 2)
    throw new Error("Upload mono or stereo audio.");
  const plan = playbackPlan(
    audio.codec_name,
    Number(audio.sample_rate),
    Number(audio.bits_per_raw_sample) ||
      Number(audio.bits_per_sample) ||
      (audio.codec_name === "pcm_f64le" || audio.codec_name === "pcm_f64be"
        ? 64
        : audio.codec_name === "pcm_f32le" || audio.codec_name === "pcm_f32be"
          ? 32
          : 0),
    probe.format.format_name,
  );
  const originalRaw = join(directory, key + ".source.pcm");
  const raw = join(directory, key + ".pcm");
  const run = (args: string[]) =>
    exec("ffmpeg", ["-nostdin", "-y", "-v", "error", "-xerror", ...args], {
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    });
  try {
    await run([
      ...audioInput,
      "-i",
      source,
      "-map",
      "0:a:0",
      "-f",
      "f32le",
      originalRaw,
    ]);
    const samples = (await stat(originalRaw)).size / (4 * audio.channels);
    if (!samples) throw new Error("Audio is empty.");
    // Floating-point masters can exceed full scale; integer PCM cannot. Reject
    // them before publishing and deleting their source rather than silently clip.
    if (/^pcm_f/.test(audio.codec_name)) {
      for await (const chunk of createReadStream(originalRaw)) {
        const bytes = chunk as Buffer;
        for (let i = 0; i < bytes.length; i += 4) {
          const value = bytes.readFloatLE(i);
          if (!Number.isFinite(value))
            throw new Error(
              "Audio contains non-finite samples. Export a valid audio file and try again.",
            );
          if (Math.abs(value) > 1)
            throw new Error(
              "Audio exceeds the PCM range. Lower peaks to 0 dBFS or below and upload again.",
            );
        }
      }
    }
    const playback = plan.keepOriginal ? key : key + ".wav";
    const output = join(directory, playback);
    // Force a real sample-format conversion for dither: 32-bit and 24-bit PCM
    // otherwise both use s32 internally and swresample may bypass quantization.
    if (!plan.keepOriginal)
      await run([
        ...audioInput,
        "-i",
        source,
        "-map",
        "0:a:0",
        "-af",
        `${plan.dither ? "aformat=sample_fmts=dbl," : ""}aresample=${plan.sampleRate}:filter_size=64:output_sample_bits=${plan.codec === "pcm_s24le" ? 24 : plan.codec === "pcm_s16le" ? 16 : 8}:dither_method=${plan.dither ? "triangular" : "none"}`,
        "-c:a",
        plan.codec,
        output,
      ]);
    await run([
      ...audioInput,
      "-i",
      output,
      "-map",
      "0:a:0",
      "-f",
      "f32le",
      raw,
    ]);
    const peaks: number[] = [];
    let peak = 0,
      allPeak = 0,
      count = 0,
      total = 0;
    const bin = Math.max(1, Math.floor(plan.sampleRate / 100) * audio.channels);
    for await (const chunk of createReadStream(raw)) {
      const bytes = chunk as Buffer;
      for (let i = 0; i < bytes.length; i += 4) {
        const value = Math.abs(bytes.readFloatLE(i));
        peak = Math.max(peak, value);
        allPeak = Math.max(allPeak, value);
        total++;
        if (++count >= bin) {
          peaks.push(peak);
          peak = 0;
          count = 0;
        }
      }
    }
    if (count) peaks.push(peak);
    const { stderr } = await exec(
      "ffmpeg",
      [
        "-nostdin",
        ...audioInput,
        "-i",
        output,
        "-af",
        "loudnorm=print_format=json",
        "-f",
        "null",
        "-",
      ],
      { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
    );
    const metrics = JSON.parse(
      stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1),
    );
    const finite = (v: string) =>
      Number.isFinite(Number(v)) ? Number(v) : null;
    return {
      original: playback,
      playback,
      duration: total / (audio.channels * plan.sampleRate),
      peaks,
      metadata: {
        audioPolicy: 2,
        wavDownload: plan.wavDownload,
        samples,
        sampleRate: Number(audio.sample_rate),
        channels: audio.channels,
        lufs: finite(metrics.input_i),
        truePeak: finite(metrics.input_tp),
        lra: finite(metrics.input_lra),
        peak: allPeak ? 20 * Math.log10(allPeak) : null,
        mime: plan.mime,
      },
    };
  } finally {
    await Promise.all([originalRaw, raw].map((p) => unlink(p).catch(() => {})));
  }
}
export function sameDuration(
  a: { samples: number; sampleRate: number },
  b: { samples: number; sampleRate: number },
) {
  return (
    BigInt(a.samples) * BigInt(b.sampleRate) ===
    BigInt(b.samples) * BigInt(a.sampleRate)
  );
}

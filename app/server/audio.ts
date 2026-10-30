import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { playbackPlan } from "./audio-policy";
const exec = promisify(execFile);
const formats = "wav,aiff,flac,mp3,mov,matroska,ogg,aac,asf,ape,wv,au,caf";
const input = [
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
      ...input,
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
    Number(audio.bits_per_raw_sample || audio.bits_per_sample || 0),
    probe.format.format_name,
  );
  const originalRaw = join(directory, key + ".source.pcm");
  const raw = join(directory, key + ".pcm");
  const run = (args: string[]) =>
    exec("ffmpeg", ["-nostdin", "-y", "-v", "error", ...args], {
      timeout: 600000,
      maxBuffer: 4 * 1024 * 1024,
    });
  try {
    await run([
      ...input,
      "-i",
      source,
      "-map",
      "0:a:0",
      "-f",
      "f32le",
      originalRaw,
    ]);
    const samples = (await stat(originalRaw)).size / (4 * audio.channels);
    const playback = plan.keepOriginal ? key : key + ".wav";
    const output = join(directory, playback);
    if (!plan.keepOriginal)
      await run([
        ...input,
        "-i",
        source,
        "-map",
        "0:a:0",
        "-ar",
        String(plan.sampleRate),
        "-c:a",
        plan.codec,
        output,
      ]);
    await run([...input, "-i", output, "-map", "0:a:0", "-f", "f32le", raw]);
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
        ...input,
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
      playback,
      duration: total / (audio.channels * plan.sampleRate),
      peaks,
      metadata: {
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

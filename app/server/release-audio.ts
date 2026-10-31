import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const exec = promisify(execFile);
// Analyze decoded AAC playback, not the WAV download. This writes no audio.
export async function measureReleasePlayback(directory: string, key: string) {
  const { stderr } = await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-xerror",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "mov",
      "-i",
      join(directory, key),
      "-map",
      "0:a:0",
      "-af",
      "astats=measure_perchannel=Peak_level:measure_overall=Peak_level,loudnorm=print_format=json",
      "-f",
      "null",
      "-",
    ],
    { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
  );
  const metrics = JSON.parse(
    stderr.slice(stderr.lastIndexOf("{"), stderr.lastIndexOf("}") + 1),
  );
  const peaks = [...stderr.matchAll(/Peak level dB: ([^\r\n]+)/g)].map((m) =>
    m[1].trim() === "-inf" ? -Infinity : Number(m[1]),
  );
  if (!peaks.length || peaks.some(Number.isNaN))
    throw new Error("Missing audio peak measurement");
  const finite = (value: string | number) =>
    Number.isFinite(Number(value)) ? Number(value) : null;
  const peak = finite(Math.max(...peaks));
  return {
    lufs: finite(metrics.input_i),
    // astats prints six decimals; round upward to keep the sample ceiling safe.
    peak: peak === null ? null : peak + 0.000001,
    truePeak: finite(metrics.input_tp),
  };
}
export async function processReleaseAudio(directory: string, key: string) {
  const source = join(directory, key);
  const input = [
    "-protocol_whitelist",
    "file,pipe",
    "-format_whitelist",
    "wav",
  ];
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
  const audio = probe.streams.find(
    (s: { codec_type: string }) => s.codec_type === "audio",
  );
  const duration = Number(probe.format.duration);
  if (
    !audio ||
    !/^pcm_/.test(audio.codec_name) ||
    ![1, 2].includes(audio.channels) ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > Number(process.env.MAX_DURATION_SECONDS || 7200)
  )
    throw new Error(
      "Upload a mono or stereo PCM WAV within the duration limit.",
    );
  const playback = key + ".m4a";
  await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-y",
      "-v",
      "error",
      ...input,
      "-i",
      source,
      "-map",
      "0:a:0",
      "-map_metadata",
      "-1",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      "-movflags",
      "+faststart",
      join(directory, playback),
    ],
    { timeout: 600000 },
  );
  return {
    playback,
    audioMeasurements: await measureReleasePlayback(directory, playback),
    duration,
    sampleRate: Number(audio.sample_rate),
    bitDepth: Number(audio.bits_per_raw_sample || audio.bits_per_sample),
  };
}

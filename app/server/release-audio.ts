import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const exec = promisify(execFile);
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
    duration,
    sampleRate: Number(audio.sample_rate),
    bitDepth: Number(audio.bits_per_raw_sample || audio.bits_per_sample),
  };
}

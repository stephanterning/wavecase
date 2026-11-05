import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { encodeMp3 } from "./audio-exports";
import { InvalidAudioError } from "./processing-errors";
import { measureAudio as measureReleasePlayback } from "./audio-measurements";
export { measureAudio as measureReleasePlayback } from "./audio-measurements";
import { prepareHls } from "./hls";
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
    throw new InvalidAudioError(
      "Upload a mono or stereo PCM WAV within the duration limit.",
    );
  const playback = await encodeMp3(directory, key);
  await prepareHls(directory, playback, key);
  return {
    playback,
    audioMeasurements: await measureReleasePlayback(directory, playback),
    duration,
    sampleRate: Number(audio.sample_rate),
    bitDepth: Number(audio.bits_per_raw_sample || audio.bits_per_sample),
  };
}

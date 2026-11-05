import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { audioInput } from "./audio-input";
const exec = promisify(execFile);
// Analyze decoded playback, not the WAV download. This writes no audio.
export async function measureAudio(directory: string, key: string) {
  const { stderr } = await exec(
    "ffmpeg",
    [
      "-nostdin",
      "-xerror",
      ...audioInput,
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

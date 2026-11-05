import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdir,
  readFile,
  writeFile,
  rename,
  link,
  rm,
  rmdir,
  stat,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { audioInput } from "./audio-input";
import { measureAudio } from "./audio-measurements";
import { playbackGainDb } from "../domain/playback-gain";

import { hlsMapping as mapping, exportTemporary } from "./storage-keys";

const exec = promisify(execFile);
export const hlsTokenPattern = /^[a-f0-9]{64}$/;
export const hlsFilePattern =
  /^(?:master\.m3u8|(?:flac|aac)(?:\.m3u8|-init\.mp4|-\d{5,}\.m4s))$/;
const preparing = new Map<string, Promise<string>>();

export async function hlsToken(
  directory: string,
  key: string,
): Promise<string | null> {
  try {
    const { token } = JSON.parse(
      await readFile(join(directory, mapping(key)), "utf8"),
    );
    if (typeof token !== "string" || !hlsTokenPattern.test(token))
      throw new Error("Invalid HLS mapping");
    await stat(join(directory, "hls", token, "master.m3u8"));
    return token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeHls(directory: string, key: string) {
  const token = await hlsToken(directory, key);
  await rm(join(directory, mapping(key)), { force: true });
  if (token)
    await rm(join(directory, "hls", token), { recursive: true, force: true });
  await rmdir(join(directory, "hls")).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
  });
}

// Only the worker creates media. Source keys are immutable upload identities;
// capabilities contain no IDs and are published only after every file is ready.
export function prepareHls(directory: string, key: string, sourceKey = key) {
  const identity = resolve(directory, key);
  let pending = preparing.get(identity);
  if (!pending) {
    pending = prepare(directory, key, sourceKey).finally(() =>
      preparing.delete(identity),
    );
    preparing.set(identity, pending);
  }
  return pending;
}

async function prepare(directory: string, key: string, sourceKey: string) {
  const cached = await hlsToken(directory, key);
  if (cached) return cached;
  const token = randomBytes(32).toString("hex");
  const root = join(directory, "hls");
  const temporary = join(root, `.${token}`);
  const destination = join(root, token);
  const sidecar = exportTemporary(join(directory, mapping(key)));
  let published = false;
  await mkdir(temporary, { recursive: true });
  try {
    const source = resolve(directory, sourceKey);
    const { stdout } = await exec(
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
        source,
      ],
      { timeout: 120000 },
    );
    const rate = Math.min(
      48000,
      Number(JSON.parse(stdout).streams[0]?.sample_rate),
    );
    if (!Number.isFinite(rate) || rate <= 0)
      throw new Error("Invalid HLS sample rate");
    const measured = await measureAudio(directory, sourceKey);
    let gain = playbackGainDb(measured);
    // Measure the encoded result too: resampling/quantization and AAC can add
    // peaks. Correct with another constant gain, never a limiter/compressor.
    async function encodeChecked(
      name: string,
      input: string,
      initialGain: number,
      codec: string[],
    ) {
      let adjustment = initialGain;
      for (let attempt = 0; attempt < 3; attempt++) {
        await exec(
          "ffmpeg",
          [
            "-nostdin",
            "-y",
            "-v",
            "error",
            "-xerror",
            ...audioInput,
            "-i",
            input,
            "-map",
            "0:a:0",
            "-vn",
            "-map_metadata",
            "-1",
            "-af",
            `volume=${adjustment}dB:precision=double`,
            ...codec,
            resolve(temporary, name),
          ],
          { timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
        );
        const result = await measureAudio(temporary, name);
        const excess = Math.max(
          result.peak ?? -Infinity,
          (result.truePeak ?? -Infinity) + 0.01,
        );
        if (excess <= 0) return adjustment;
        adjustment -= excess + 0.1;
      }
      throw new Error("HLS peak ceiling could not be met");
    }
    gain = await encodeChecked("normalized.flac", source, gain, [
      "-ar",
      String(rate),
      "-c:a",
      "flac",
      "-sample_fmt",
      "s32",
      "-bits_per_raw_sample",
      "24",
    ]);
    const aacRate =
      [48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000].find(
        (value) => value <= rate,
      ) ?? 8000;
    const aacGain = await encodeChecked(
      "normalized.m4a",
      resolve(temporary, "normalized.flac"),
      0,
      [
        "-ar",
        String(aacRate),
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        "-movflags",
        "+faststart",
      ],
    );
    const bandwidths: number[] = [];
    for (const [format, input] of [
      ["flac", "normalized.flac"],
      ["aac", "normalized.m4a"],
    ]) {
      await exec(
        "ffmpeg",
        [
          "-nostdin",
          "-y",
          "-v",
          "error",
          "-xerror",
          ...audioInput,
          "-i",
          resolve(temporary, input),
          "-map",
          "0:a:0",
          "-map_metadata",
          "-1",
          "-c:a",
          "copy",
          "-f",
          "hls",
          "-hls_time",
          "2",
          "-hls_playlist_type",
          "vod",
          "-hls_segment_type",
          "fmp4",
          "-hls_segment_options",
          "strict=experimental",
          "-hls_fmp4_init_filename",
          `${format}-init.mp4`,
          "-hls_segment_filename",
          resolve(temporary, `${format}-%05d.m4s`),
          resolve(temporary, `${format}.m3u8`),
        ],
        { cwd: temporary, timeout: 600000, maxBuffer: 4 * 1024 * 1024 },
      );
      const playlist = await readFile(
        join(temporary, `${format}.m3u8`),
        "utf8",
      );
      let peak = 0;
      for (const match of playlist.matchAll(
        /#EXTINF:([\d.]+),\s*\n([^\n]+)/g,
      )) {
        const size = (await stat(join(temporary, match[2].trim()))).size;
        peak = Math.max(peak, (size * 8) / Number(match[1]));
      }
      if (
        !Number.isFinite(peak) ||
        peak <= 0 ||
        !playlist.includes("#EXT-X-ENDLIST")
      )
        throw new Error("Invalid HLS playlist");
      bandwidths.push(Math.ceil(peak * 1.1));
    }
    await writeFile(
      join(temporary, "master.m3u8"),
      `#EXTM3U\n#EXT-X-VERSION:7\n#EXT-X-STREAM-INF:BANDWIDTH=${bandwidths[0]},CODECS="fLaC"\nflac.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=${bandwidths[1]},CODECS="mp4a.40.2"\naac.m3u8\n`,
    );
    await rm(join(temporary, "normalized.flac"));
    await rm(join(temporary, "normalized.m4a"));
    await writeFile(
      sidecar,
      JSON.stringify({ token, gainDb: gain, aacGainDb: gain + aacGain }),
    );
    await rename(temporary, destination);
    try {
      // An exclusive link also handles a second worker finishing the same key.
      await link(sidecar, join(directory, mapping(key)));
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const winner = await hlsToken(directory, key);
      if (!winner) throw new Error("Incomplete existing HLS publication");
      return winner;
    }
    // Deletion unlinks sources before removing HLS. This post-publication check
    // closes the race where deletion happened while encoding was in progress.
    await stat(join(directory, key));
    await stat(source);
    return token;
  } catch (error) {
    if (published) await removeHls(directory, key);
    throw error;
  } finally {
    await rm(sidecar, { force: true });
    await rm(temporary, { recursive: true, force: true });
    if (!published) await rm(destination, { recursive: true, force: true });
  }
}

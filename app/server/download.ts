import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, stat, unlink } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { versions } from "./schema";
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

export async function mp3Download(
  versionId: string,
  original: string,
  directory: string,
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
    return encodeMp3(directory, original);
  });
}

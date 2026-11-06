import { execFile } from "node:child_process";
import { readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { artworkFile, exportTemporary } from "./storage-keys";

const pending = new Map<string, Promise<Buffer<ArrayBuffer>>>();

// Upload keys are immutable. Existing images acquire their derivatives on first
// use; later requests (and server restarts) reuse the files without re-encoding.
export async function webArtwork(
  directory: string,
  cover: string,
  kind: "web" | "media" = "web",
) {
  const path = join(directory, artworkFile(cover, kind));
  const current = pending.get(path);
  if (current) return current;
  const task = prepare(directory, cover, kind, path);
  pending.set(path, task);
  try {
    return await task;
  } finally {
    pending.delete(path);
  }
}

async function prepare(
  directory: string,
  cover: string,
  kind: "web" | "media",
  path: string,
) {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const input = join(directory, cover);
  const { stdout } = await promisify(execFile)(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-threads",
      "1",
      "-protocol_whitelist",
      "file",
      "-format_whitelist",
      "png_pipe,jpeg_pipe,webp_pipe",
      "-i",
      input,
      "-frames:v",
      "1",
      "-vf",
      kind === "web"
        ? "scale=w='min(1000,iw)':h='min(1000,ih)':force_original_aspect_ratio=decrease"
        : "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,setsar=1",
      ...(kind === "web"
        ? ["-c:v", "libwebp", "-quality", "80"]
        : ["-c:v", "mjpeg", "-pix_fmt", "yuvj420p", "-q:v", "3"]),
      "-threads",
      "1",
      "-f",
      "image2pipe",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 30000, maxBuffer: 8 * 1024 * 1024 },
  );
  const staging = exportTemporary(path);
  try {
    await writeFile(staging, stdout);
    await rename(staging, path);
    // Do not leave an orphan if the cover was removed during conversion.
    await stat(input);
  } catch (error) {
    await unlink(staging).catch(() => {});
    await unlink(path).catch(() => {});
    throw error;
  }
  return stdout;
}

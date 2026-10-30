import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db";
import { artists, releases, releaseTracks } from "./schema";
import { requireUser, viewer } from "./security";
export const directory = () => process.env.DATA_DIR || "data/audio";
export async function ownedArtist(request: Request, id: string) {
  const user = await requireUser(request);
  const artist = await db.query.artists.findFirst({
    where: and(
      eq(artists.id, z.uuid().parse(id)),
      eq(artists.ownerId, user.id),
    ),
  });
  if (!artist) throw new Response("Artist not found", { status: 404 });
  return artist;
}
export async function releaseAccess(
  request: Request,
  id: string,
  ownerOnly = false,
) {
  if (!z.uuid().safeParse(id).success)
    throw new Response("Not found", { status: 404 });
  const [row] = await db
    .select({ release: releases, artist: artists })
    .from(releases)
    .innerJoin(artists, eq(releases.artistId, artists.id))
    .where(eq(releases.id, id));
  const user = await viewer(request);
  const owner = !!user && row?.artist.ownerId === user.id;
  if (!row || (ownerOnly ? !owner : !row.release.published && !owner))
    throw new Response("Release not found", { status: 404 });
  const tracks = await db
    .select()
    .from(releaseTracks)
    .where(eq(releaseTracks.releaseId, id))
    .orderBy(asc(releaseTracks.position), asc(releaseTracks.id));
  return { ...row, owner, tracks };
}

export async function storeFile(file: File, limit: number) {
  if (!file.size || file.size > limit)
    throw new Response("Choose a file within the upload size limit.", {
      status: 400,
    });
  await mkdir(directory(), { recursive: true });
  const key = randomUUID();
  await writeFile(
    join(directory(), key),
    Buffer.from(await file.arrayBuffer()),
  );
  return key;
}
export async function storeArtwork(file: File) {
  const key = await storeFile(file, 10 * 1024 * 1024);
  try {
    await promisify(execFile)(
      "ffmpeg",
      [
        "-nostdin",
        "-y",
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        "png_pipe,jpeg_pipe,webp_pipe",
        "-i",
        join(directory(), key),
        "-frames:v",
        "1",
        "-vf",
        "scale=2000:2000:force_original_aspect_ratio=decrease",
        join(directory(), key + ".png"),
      ],
      { timeout: 30000 },
    );
    return key + ".png";
  } catch {
    await unlink(join(directory(), key + ".png")).catch(() => {});
    throw new Response("Choose a valid PNG, JPG, or WebP image.", {
      status: 400,
    });
  } finally {
    await unlink(join(directory(), key)).catch(() => {});
  }
}

// Keep full-resolution covers for pages/downloads, but send small, square
// artwork to native media controls. Generate from the current authorized cover
// so existing releases work without re-uploading or retaining another file.
export async function mediaArtwork(cover: string) {
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
      "png_pipe",
      "-i",
      join(directory(), cover),
      "-frames:v",
      "1",
      "-vf",
      "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2,setsar=1",
      "-c:v",
      "mjpeg",
      "-pix_fmt",
      "yuvj420p",
      "-q:v",
      "3",
      "-threads",
      "1",
      "-f",
      "image2pipe",
      "pipe:1",
    ],
    { encoding: "buffer", timeout: 10000, maxBuffer: 1024 * 1024 },
  );
  return stdout;
}
export function publicRelease(data: Awaited<ReturnType<typeof releaseAccess>>) {
  return {
    artist: { name: data.artist.name, slug: data.artist.slug },
    owner: data.owner,
    release: data.release,
    tracks: data.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      position: t.position,
      metadata: t.metadata,
      duration: t.duration,
      sampleRate: t.sampleRate,
      bitDepth: t.bitDepth,
      available: data.release.audioEnabled && !!t.original && !!t.playback,
    })),
  };
}
export async function formError(error: unknown) {
  if (error instanceof z.ZodError)
    return { error: error.issues.map((i) => i.message).join(" ") };
  if (error instanceof Response && error.status < 500)
    return { error: await error.text() };
  if (
    (error as { cause?: { code?: string } })?.cause?.code === "23505" ||
    (error as { code?: string })?.code === "23505"
  )
    return {
      error: "That address is already in use. Choose a meaningful alternative.",
    };
  throw error;
}

import { artistScope, ownsArtist } from "./ownership";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { db } from "./db";
import { artists, releases, releaseTracks } from "./schema";
import { requireUser, viewer } from "./security";
import { dataDir } from "./config";
import { storeUpload, type Upload } from "./request";
import { webArtwork } from "./artwork";
import { removeAudioFiles } from "./audio-files";
export const directory = dataDir;
export async function ownedArtist(request: Request, id: string) {
  const user = await requireUser(request);
  const artist = await db.query.artists.findFirst({
    where: and(eq(artists.id, z.uuid().parse(id)), artistScope(user.id)),
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
  const owner = !!row && (await ownsArtist(user?.id, row.artist));
  if (!row || (ownerOnly ? !owner : !row.release.published && !owner))
    throw new Response("Release not found", { status: 404 });
  const tracks = await db
    .select()
    .from(releaseTracks)
    .where(eq(releaseTracks.releaseId, id))
    .orderBy(asc(releaseTracks.position), asc(releaseTracks.id));
  return { ...row, owner, tracks };
}

export async function storeArtwork(file: Upload) {
  const key = await storeUpload(file, { limit: 10 * 1024 * 1024 });
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
    await webArtwork(directory(), key + ".png");
    return key + ".png";
  } catch {
    await removeAudioFiles(directory(), [key + ".png"]);
    throw new Response("Choose a valid PNG, JPG, or WebP image.", {
      status: 400,
    });
  } finally {
    await unlink(join(directory(), key)).catch(() => {});
  }
}

// Native controls use their own fitted square derivative.
export async function mediaArtwork(cover: string) {
  return webArtwork(directory(), cover, "media");
}
export function publicRelease(data: Awaited<ReturnType<typeof releaseAccess>>) {
  return {
    artist: { name: data.artist.name, slug: data.artist.slug },
    owner: data.owner,
    release: {
      id: data.release.id,
      title: data.release.title,
      slug: data.release.slug,
      kind: data.release.kind,
      description: data.release.description,
      metadata: data.release.metadata,
      links: data.release.links,
      published: data.release.published,
    },
    tracks: data.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      position: t.position,
      metadata: t.metadata,
      duration: t.duration,
      sampleRate: t.sampleRate,
      bitDepth: t.bitDepth,
      audioMeasurements: t.audioMeasurements,
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

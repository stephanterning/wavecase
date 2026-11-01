import { and, eq, inArray } from "drizzle-orm";
import { db } from "./db";
import {
  tracks,
  versions,
  links,
  comments,
  events,
  reuploadRequests,
} from "./schema";
import { removeAudioFiles } from "./audio-files";

// Lock parents before removing children so concurrent uploads and feedback cannot
// leave new rows behind after the deletion transaction commits.
export async function deleteDemo(
  trackId: string,
  ownerId: string,
  title: string,
) {
  const files = await db.transaction(async (tx) => {
    const [track] = await tx
      .select()
      .from(tracks)
      .where(and(eq(tracks.id, trackId), eq(tracks.ownerId, ownerId)))
      .for("update");
    if (!track) throw new Response("Not found", { status: 404 });
    if (title !== track.title)
      throw new Response("Type the track title exactly to confirm deletion.", {
        status: 400,
      });
    const all = await tx
      .select()
      .from(versions)
      .where(eq(versions.trackId, trackId))
      .for("update");
    const shareLinks = await tx
      .select()
      .from(links)
      .where(eq(links.trackId, trackId))
      .for("update");
    const ids = shareLinks.map((link) => link.id);
    if (ids.length) {
      await tx.delete(comments).where(inArray(comments.linkId, ids));
      await tx.delete(events).where(inArray(events.linkId, ids));
    }
    await tx
      .delete(reuploadRequests)
      .where(eq(reuploadRequests.trackId, trackId));
    await tx.delete(links).where(eq(links.trackId, trackId));
    await tx.delete(versions).where(eq(versions.trackId, trackId));
    await tx.delete(tracks).where(eq(tracks.id, trackId));
    return [
      track.cover,
      ...all.flatMap((v) => [
        v.original,
        v.playback,
        v.pendingOriginal,
        v.pendingOriginal ? v.pendingOriginal + ".wav" : null,
      ]),
    ];
  });
  await removeAudioFiles(process.env.DATA_DIR || "data/audio", files);
}

export async function deleteShareLink(trackId: string, linkId: string) {
  await db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(links)
      .where(and(eq(links.id, linkId), eq(links.trackId, trackId)))
      .for("update");
    if (!link) throw new Response("Not found", { status: 404 });
    await tx.delete(comments).where(eq(comments.linkId, linkId));
    await tx.delete(events).where(eq(events.linkId, linkId));
    await tx
      .delete(reuploadRequests)
      .where(eq(reuploadRequests.linkId, linkId));
    await tx.delete(links).where(eq(links.id, linkId));
  });
}

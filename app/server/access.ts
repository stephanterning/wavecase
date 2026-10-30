import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { tracks, links, versions } from "./schema";
import { viewer } from "./security";
export async function trackAccess(
  request: Request,
  id: string,
  share?: string,
) {
  if (!z.uuid().safeParse(id).success)
    throw new Response("Not found", { status: 404 });
  const track = await db.query.tracks.findFirst({ where: eq(tracks.id, id) });
  const user = await viewer(request);
  if (track && user?.id === track.ownerId)
    return { track, owner: true, link: null };
  const link = share
    ? await db.query.links.findFirst({ where: eq(links.id, share) })
    : null;
  if (!track || !link || !link.active || link.trackId !== id)
    throw new Response("This link is unavailable.", { status: 404 });
  return { track, owner: false, link };
}
export async function versionAccess(
  request: Request,
  id: string,
  share?: string,
) {
  if (!z.uuid().safeParse(id).success)
    throw new Response("Not found", { status: 404 });
  const version = await db.query.versions.findFirst({
    where: eq(versions.id, id),
  });
  if (!version) throw new Response("Not found", { status: 404 });
  const access = await trackAccess(request, version.trackId, share);
  if (
    !access.owner &&
    (version.state === "processing" ||
      version.state === "failed" ||
      (access.link?.fromOrder && version.position < access.link.fromOrder))
  )
    throw new Response("Not found", { status: 404 });
  return { ...access, version };
}

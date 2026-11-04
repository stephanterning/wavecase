import { trackScope } from "./ownership";
import { ownerPreview } from "./preview";
import { visibleThroughLink } from "../domain/share-links";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
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
  const user = await viewer(request);
  const [row] = await db
    .select({
      track: tracks,
      owned: user ? trackScope(user.id) : sql<boolean>`false`,
    })
    .from(tracks)
    .where(eq(tracks.id, id));
  const track = row?.track;
  const preview = ownerPreview(request, !!row?.owned);
  if (track && row.owned && !preview)
    return { track, owner: true, link: null, preview: false };
  const link = share
    ? await db.query.links.findFirst({ where: eq(links.id, share) })
    : null;
  if (!track || !link || !link.active || link.trackId !== id)
    throw new Response("This link is unavailable.", { status: 404 });
  return { track, owner: false, link, preview };
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
  if (!access.owner && !visibleThroughLink(version, access.link!))
    throw new Response("Not found", { status: 404 });
  return { ...access, version };
}

import type { Params } from "react-router";
import { desc, eq, getTableColumns } from "drizzle-orm";
import { visibleThroughLink } from "../domain/share-links";
import { trackAccess } from "./access";
import { db } from "./db";
import { links, versions } from "./schema";
import { hash, origin } from "./security";
import { linkedArtist } from "./track-artist";

const { peaks, ...versionColumns } = getTableColumns(versions);

/** Page data shared by the track loader and its status poll. The fingerprint
 * covers everything here, so polls detect changes without sending peaks. */
export async function trackPage(request: Request, params: Params) {
  let id = params.id;
  const share = params.share;
  if (share) {
    const link = await db.query.links.findFirst({ where: eq(links.id, share) });
    if (!link?.active)
      throw new Response("This link is unavailable.", { status: 404 });
    id = link.trackId;
  }
  const access = await trackAccess(request, id!, share);
  const artist = await linkedArtist(access.track.artistId);
  const visible = (
    await db
      .select(versionColumns)
      .from(versions)
      .where(eq(versions.trackId, access.track.id))
      .orderBy(desc(versions.position))
  ).filter((v) => access.owner || visibleThroughLink(v, access.link!));
  const page = {
    track: {
      id: access.track.id,
      title: access.track.title,
      artist: artist?.name || access.track.artist,
      description: access.track.description,
      cover: !!access.track.cover,
      coverRevision: access.track.cover ? hash(access.track.cover) : null,
      ...(access.owner ? { artistId: access.track.artistId } : {}),
    },
    artistUrl: artist
      ? access.owner
        ? `/artist-profiles/${artist.id}`
        : `/artists/${artist.slug}`
      : null,
    artistImageUrl: artist?.hasImage ? `/artist-images/${artist.id}` : null,
    owner: access.owner,
    preview: access.preview,
    share,
    shareUrl: share ? `${origin}/s/${encodeURIComponent(share)}` : null,
    versions: visible.map((v) => ({
      id: v.id,
      name: v.name,
      description: v.description,
      status: v.status,
      state: v.state,
      duration: v.duration,
      metadata: v.metadata,
      revision: v.original ? hash(v.original) : "missing",
      canDownload:
        !!v.original &&
        (access.owner || (!!access.link?.download && v.download)),
      ...(access.owner
        ? {
            position: v.position,
            filename: v.filename,
            error: v.error,
            download: v.download,
            processing: !!v.pendingOriginal,
          }
        : {}),
    })),
  };
  return {
    access,
    visible,
    page,
    fingerprint: hash(JSON.stringify(page)),
  };
}

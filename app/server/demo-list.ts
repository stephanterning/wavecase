import { and, desc, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import { db } from "./db";
import { trackScope } from "./ownership";
import { artists, trackFavorites, tracks, versions } from "./schema";
import { hash } from "./security";

export async function demoList(userId: string, artistId?: string) {
  // Reconcile against the whole workspace so opening an artist does not stop
  // another artist's still-accessible demo or an older selected version.
  const ready = await db
    .select({
      id: versions.id,
      trackId: versions.trackId,
      original: versions.original,
      name: versions.name,
      metadata: versions.metadata,
      duration: versions.duration,
    })
    .from(versions)
    .innerJoin(tracks, eq(versions.trackId, tracks.id))
    .where(
      and(
        trackScope(userId),
        eq(versions.state, "ready"),
        isNotNull(versions.playback),
      ),
    )
    .orderBy(desc(versions.position));
  const playable = ready.map(({ original, ...version }) => ({
    ...version,
    revision: original ? hash(original) : "missing",
  }));
  const rows = await db
    .select({
      ...getTableColumns(tracks),
      artist: sql<string>`coalesce(${artists.name}, ${tracks.artist})`,
      favorite: sql<boolean>`exists (${db
        .select({ id: trackFavorites.trackId })
        .from(trackFavorites)
        .where(
          and(
            eq(trackFavorites.trackId, tracks.id),
            eq(trackFavorites.userId, userId),
          ),
        )})`,
      versionCount: sql<number>`(${db
        .select({ count: sql<number>`count(*)::integer` })
        .from(versions)
        .where(eq(versions.trackId, tracks.id))})`,
      updatedAt: sql<string | null>`(${db
        .select({
          uploadedAt: sql<string | null>`max(${versions.uploadedAt})::text`,
        })
        .from(versions)
        .where(eq(versions.trackId, tracks.id))})`,
      latestVersion: sql<string | null>`(${db
        .select({ name: versions.name })
        .from(versions)
        .where(eq(versions.trackId, tracks.id))
        .orderBy(desc(versions.position))
        .limit(1)})`,
      latestStatus: sql<string | null>`(${db
        .select({ status: versions.status })
        .from(versions)
        .where(eq(versions.trackId, tracks.id))
        .orderBy(desc(versions.position))
        .limit(1)})`,
    })
    .from(tracks)
    .leftJoin(artists, eq(tracks.artistId, artists.id))
    .where(
      and(
        trackScope(userId),
        artistId ? eq(tracks.artistId, artistId) : undefined,
      ),
    );
  return {
    tracks: rows.map((track) => ({ ...track, cover: !!track.cover })),
    availableSources: playable.map((version) => version.id + version.revision),
    playable: playable.filter(
      (version, index) =>
        rows.some((track) => track.id === version.trackId) &&
        playable.findIndex((other) => other.trackId === version.trackId) ===
          index,
    ),
  };
}

export type DemoListData = Awaited<ReturnType<typeof demoList>>;

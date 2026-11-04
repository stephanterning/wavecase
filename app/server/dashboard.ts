import { artistScope, trackScope } from "./ownership";
import { and, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "./db";
import {
  artists,
  tracks,
  releases,
  versions,
  comments,
  links,
  events,
  releaseEvents,
} from "./schema";
export async function dashboard(
  ownerId: string,
  period: string | null,
  now = new Date(),
) {
  const selected = period === "7" || period === "all" ? period : "30";
  const since =
    selected === "all"
      ? null
      : new Date(now.getTime() - Number(selected) * 86400000);
  const demoOwner = trackScope(ownerId),
    artistOwner = artistScope(ownerId);
  const feedbackWhere = and(
    demoOwner,
    eq(comments.owner, false),
    isNotNull(comments.body),
    since ? gte(comments.createdAt, since) : undefined,
    lte(comments.createdAt, now),
  );
  const [
    inventory,
    demo,
    release,
    feedbackCount,
    activeLinks,
    feedback,
    recentTracks,
    recentReleases,
  ] = await Promise.all([
    db
      .select({
        demos: sql<number>`(select count(*)::int from tracks where ${demoOwner})`,
        artists: sql<number>`count(distinct ${artists.id})::int`,
        published: sql<number>`count(${releases.id}) filter (where ${releases.published})::int`,
        drafts: sql<number>`count(${releases.id}) filter (where not ${releases.published})::int`,
      })
      .from(artists)
      .leftJoin(releases, eq(releases.artistId, artists.id))
      .where(artistOwner),
    db
      .select({
        plays: sql<number>`count(*) filter (where ${events.kind}='play')::int`,
        downloads: sql<number>`count(*) filter (where ${events.kind}='download-started')::int`,
      })
      .from(events)
      .innerJoin(links, eq(events.linkId, links.id))
      .innerJoin(tracks, eq(links.trackId, tracks.id))
      .where(
        and(
          demoOwner,
          since ? gte(events.createdAt, since) : undefined,
          lte(events.createdAt, now),
        ),
      ),
    db
      .select({
        visits: sql<number>`count(*) filter (where ${releaseEvents.kind}='visit')::int`,
        plays: sql<number>`count(*) filter (where ${releaseEvents.kind}='play')::int`,
        downloads: sql<number>`count(*) filter (where ${releaseEvents.kind}='download-started')::int`,
        clicks: sql<number>`count(*) filter (where ${releaseEvents.kind}='click')::int`,
      })
      .from(releaseEvents)
      .innerJoin(releases, eq(releaseEvents.releaseId, releases.id))
      .innerJoin(artists, eq(releases.artistId, artists.id))
      .where(
        and(
          artistOwner,
          since ? gte(releaseEvents.createdAt, since) : undefined,
          lte(releaseEvents.createdAt, now),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(comments)
      .innerJoin(versions, eq(comments.versionId, versions.id))
      .innerJoin(tracks, eq(versions.trackId, tracks.id))
      .where(feedbackWhere),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(links)
      .innerJoin(tracks, eq(links.trackId, tracks.id))
      .where(and(demoOwner, eq(links.active, true))),
    db
      .select({
        id: comments.id,
        name: comments.name,
        body: sql<string>`left(${comments.body}, 180)`,
        createdAt: comments.createdAt,
        trackId: tracks.id,
        title: tracks.title,
        versionId: versions.id,
        version: versions.name,
      })
      .from(comments)
      .innerJoin(versions, eq(comments.versionId, versions.id))
      .innerJoin(tracks, eq(versions.trackId, tracks.id))
      .where(feedbackWhere)
      .orderBy(desc(comments.createdAt), desc(comments.id))
      .limit(5),
    db
      .select({
        id: tracks.id,
        title: tracks.title,
        createdAt: tracks.createdAt,
      })
      .from(tracks)
      .where(demoOwner)
      .orderBy(desc(tracks.createdAt), desc(tracks.id))
      .limit(5),
    db
      .select({
        id: releases.id,
        title: releases.title,
        createdAt: releases.createdAt,
      })
      .from(releases)
      .innerJoin(artists, eq(releases.artistId, artists.id))
      .where(artistOwner)
      .orderBy(desc(releases.createdAt), desc(releases.id))
      .limit(5),
  ]);
  return {
    period: selected,
    inventory: inventory[0],
    demo: {
      ...demo[0],
      feedback: feedbackCount[0].count,
      links: activeLinks[0].count,
    },
    release: release[0],
    feedback,
    recent: [
      ...recentTracks.map((t) => ({
        ...t,
        kind: "Demo",
        href: `/tracks/${t.id}`,
      })),
      ...recentReleases.map((r) => ({
        ...r,
        kind: "Release",
        href: `/releases/${r.id}`,
      })),
    ]
      .sort(
        (a, b) =>
          b.createdAt.getTime() - a.createdAt.getTime() ||
          a.id.localeCompare(b.id),
      )
      .slice(0, 5),
  };
}

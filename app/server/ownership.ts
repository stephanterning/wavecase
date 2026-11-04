import { and, eq, sql, type SQLWrapper } from "drizzle-orm";
import { db } from "./db";
import { artists, artistMembers, tracks } from "./schema";

// Membership never grants access to another artist or to unlinked personal demos.
export function artistScope(userId: string, artistId: SQLWrapper = artists.id) {
  return sql<boolean>`exists (select 1 from artists a where a.id = ${artistId}
    and (a."ownerId" = ${userId} or exists (select 1 from artist_members m
      where m."artistId" = a.id and m."userId" = ${userId})))`;
}
export function trackScope(userId: string) {
  return sql<boolean>`((${tracks.artistId} is null and ${tracks.ownerId} = ${userId})
    or ${artistScope(userId, tracks.artistId)})`;
}
export async function ownsArtist(
  userId: string | undefined,
  artist: typeof artists.$inferSelect,
) {
  if (!userId) return false;
  if (artist.ownerId === userId) return true;
  const member = await db.query.artistMembers.findFirst({
    where: and(
      eq(artistMembers.artistId, artist.id),
      eq(artistMembers.userId, userId),
    ),
  });
  return !!member;
}

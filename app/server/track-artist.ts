import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { artists } from "./schema";

const profileFields = {
  id: artists.id,
  name: artists.name,
  slug: artists.slug,
};
export async function artistChoices(ownerId: string) {
  return db
    .select(profileFields)
    .from(artists)
    .where(eq(artists.ownerId, ownerId))
    .orderBy(asc(artists.name), asc(artists.slug));
}
export async function linkedArtist(ownerId: string, artistId: string | null) {
  if (!artistId) return null;
  const [artist] = await db
    .select({
      ...profileFields,
      hasImage: sql<boolean>`${artists.image} is not null`,
    })
    .from(artists)
    .where(and(eq(artists.id, artistId), eq(artists.ownerId, ownerId)));
  return artist || null;
}
export async function resolveTrackArtist(ownerId: string, form: FormData) {
  const selected = form.get("artistId");
  if (selected) {
    const id = z.uuid().safeParse(selected);
    const artist = id.success ? await linkedArtist(ownerId, id.data) : null;
    if (!artist)
      throw new Response("Choose one of your own artist profiles.", {
        status: 400,
      });
    return { artistId: artist.id, artist: artist.name };
  }
  const parsed = z
    .string()
    .trim()
    .max(200)
    .safeParse(form.get("artist") || "");
  if (!parsed.success)
    throw new Response("Enter an artist name of up to 200 characters.", {
      status: 400,
    });
  const name = parsed.data;
  if (!name) return { artistId: null, artist: "" };
  const matches = await db
    .select(profileFields)
    .from(artists)
    .where(
      and(
        eq(artists.ownerId, ownerId),
        sql`lower(regexp_replace(${artists.name}, '^[[:space:]]+|[[:space:]]+$', '', 'g')) = lower(${name})`,
      ),
    )
    .limit(2);
  const match = matches.length === 1 ? matches[0] : null;
  return { artistId: match?.id || null, artist: match?.name || name };
}

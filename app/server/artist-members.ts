import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { artists, artistMembers, artistInvitations } from "./schema";
import { token } from "./security";

const unavailable = () =>
  new Response(
    "This invitation link has expired, been revoked or already been used.",
    { status: 404 },
  );

export async function artistInvitation(id: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(id)) throw unavailable();
  const [row] = await db
    .select({ invitation: artistInvitations, artist: artists })
    .from(artistInvitations)
    .innerJoin(artists, eq(artistInvitations.artistId, artists.id))
    .where(
      and(
        eq(artistInvitations.id, id),
        gt(artistInvitations.expires, new Date()),
      ),
    );
  if (!row) throw unavailable();
  return row;
}

export async function acceptArtistInvitation(userId: string, id: string) {
  const { artist } = await artistInvitation(id);
  return db.transaction(async (tx) => {
    // Membership changes and invitation consumption lock the artist first.
    // Concurrent acceptance or revocation therefore has exactly one winner.
    await tx
      .select({ id: artists.id })
      .from(artists)
      .where(eq(artists.id, artist.id))
      .for("update");
    const invitation = await tx.query.artistInvitations.findFirst({
      where: and(
        eq(artistInvitations.id, id),
        gt(artistInvitations.expires, new Date()),
      ),
    });
    if (!invitation) throw unavailable();
    const member = await tx.query.artistMembers.findFirst({
      where: and(
        eq(artistMembers.artistId, artist.id),
        eq(artistMembers.userId, userId),
      ),
    });
    if (artist.ownerId === userId || member)
      throw new Response("This artist is already connected to your account.", {
        status: 400,
      });
    await tx.insert(artistMembers).values({ artistId: artist.id, userId });
    await tx.delete(artistInvitations).where(eq(artistInvitations.id, id));
    return artist.id;
  });
}

export async function manageArtistMembers(
  userId: string,
  artistId: string,
  form: FormData,
) {
  return db.transaction(async (tx) => {
    const [artist] = await tx
      .select()
      .from(artists)
      .where(eq(artists.id, artistId))
      .for("update");
    if (!artist) throw new Response("Artist not found", { status: 404 });
    const intent = form.get("intent");
    if (intent === "leave-artist") {
      if (artist.ownerId === userId)
        throw new Response("The membership manager cannot leave the artist.", {
          status: 400,
        });
      await tx
        .delete(artistMembers)
        .where(
          and(
            eq(artistMembers.artistId, artistId),
            eq(artistMembers.userId, userId),
          ),
        );
      return;
    }
    if (artist.ownerId !== userId)
      throw new Response("Only the membership manager can change membership.", {
        status: 403,
      });
    if (intent === "remove-member") {
      await tx
        .delete(artistMembers)
        .where(
          and(
            eq(artistMembers.artistId, artistId),
            eq(artistMembers.id, z.uuid().parse(form.get("member"))),
          ),
        );
    } else if (intent === "create-invitation") {
      const id = token();
      await tx.insert(artistInvitations).values({
        id,
        artistId,
        label:
          z
            .string()
            .trim()
            .max(200)
            .parse(form.get("label") || "") || "Co-owner invitation",
        expires: new Date(Date.now() + 7 * 86400000),
      });
      return id;
    } else if (intent === "revoke-invitation") {
      await tx
        .delete(artistInvitations)
        .where(
          and(
            eq(artistInvitations.artistId, artistId),
            eq(artistInvitations.id, String(form.get("invitation"))),
          ),
        );
    } else throw new Response("Unknown membership action", { status: 400 });
  });
}

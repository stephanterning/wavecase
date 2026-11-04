import { and, eq, gt, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { artists, artistMembers, users } from "./schema";

export async function pendingArtistInvitations(userId: string) {
  return db
    .select({
      id: artistMembers.id,
      artist: artists.name,
      invitedBy: users.name,
    })
    .from(artistMembers)
    .innerJoin(artists, eq(artists.id, artistMembers.artistId))
    .innerJoin(users, eq(users.id, artists.ownerId))
    .where(
      and(
        eq(artistMembers.userId, userId),
        isNull(artistMembers.acceptedAt),
        gt(artistMembers.expires, new Date()),
      ),
    )
    .orderBy(asc(artists.name));
}
export async function answerArtistInvitation(userId: string, form: FormData) {
  const condition = and(
    eq(artistMembers.id, z.uuid().parse(form.get("invitation"))),
    eq(artistMembers.userId, userId),
    isNull(artistMembers.acceptedAt),
    gt(artistMembers.expires, new Date()),
  );
  const rows =
    form.get("intent") === "accept-invitation"
      ? await db
          .update(artistMembers)
          .set({ acceptedAt: new Date() })
          .where(condition)
          .returning()
      : await db.delete(artistMembers).where(condition).returning();
  if (!rows.length)
    throw new Response("Invitation unavailable or expired.", { status: 404 });
  return rows[0].artistId;
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
    } else if (intent === "invite-member") {
      const email = z.email().parse(String(form.get("email") || "").trim());
      // Exact account address avoids exposing a searchable directory of accounts.
      const user = await tx.query.users.findFirst({
        where: and(eq(users.email, email), eq(users.disabled, false)),
      });
      if (!user || user.id === userId)
        throw new Response(
          "Enter the exact email of another active, registered account.",
          { status: 400 },
        );
      const existing = await tx.query.artistMembers.findFirst({
        where: and(
          eq(artistMembers.artistId, artistId),
          eq(artistMembers.userId, user.id),
        ),
      });
      if (existing?.acceptedAt)
        throw new Response("This account already co-owns the artist.", {
          status: 400,
        });
      const expires = new Date(Date.now() + 7 * 86400000);
      await tx
        .insert(artistMembers)
        .values({ artistId, userId: user.id, expires })
        .onConflictDoUpdate({
          target: [artistMembers.artistId, artistMembers.userId],
          set: { expires },
        });
    } else throw new Response("Unknown membership action", { status: 400 });
  });
}

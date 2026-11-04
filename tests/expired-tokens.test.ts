import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, pool } from "../app/server/db";
import {
  artistInvitations,
  artists,
  challenges,
  invitations,
  recoveries,
  sessions,
  users,
} from "../app/server/schema";
import { deleteExpiredTokens } from "../app/server/security";
import { enabled } from "./database";
after(() => pool.end());

test(
  "expired tokens are deleted while usable ones remain",
  { skip: !enabled },
  async () => {
    const user = randomUUID(),
      artist = randomUUID();
    await db.insert(users).values({
      id: user,
      name: "Expiry owner",
      email: user + "@test.invalid",
    });
    await db
      .insert(artists)
      .values({ id: artist, ownerId: user, name: "Expiry", slug: artist });
    const expired = new Date(Date.now() - 1000);
    const valid = new Date(Date.now() + 60000);
    const ids = (prefix: string) => ({
      expired: prefix + "-expired-" + randomUUID(),
      valid: prefix + "-valid-" + randomUUID(),
    });
    const challenge = ids("challenge"),
      session = ids("session"),
      recovery = ids("recovery"),
      invitation = ids("invitation"),
      used = "invitation-used-" + randomUUID(),
      artistInvitation = ids("artist-invitation");
    await db.insert(challenges).values(
      [challenge.expired, challenge.valid].map((id, index) => ({
        id,
        value: "challenge",
        payload: {},
        kind: "authentication",
        expires: index ? valid : expired,
      })),
    );
    await db.insert(sessions).values([
      { id: session.expired, userId: user, expires: expired },
      { id: session.valid, userId: user, expires: valid },
    ]);
    await db.insert(recoveries).values([
      { id: recovery.expired, userId: user, expires: expired },
      { id: recovery.valid, userId: user, expires: valid },
    ]);
    await db.insert(invitations).values([
      { id: invitation.expired, expires: expired },
      { id: invitation.valid, expires: valid },
      { id: used, expires: valid, used: true },
    ]);
    await db.insert(artistInvitations).values([
      {
        id: artistInvitation.expired,
        artistId: artist,
        label: "Expired",
        expires: expired,
      },
      {
        id: artistInvitation.valid,
        artistId: artist,
        label: "Valid",
        expires: valid,
      },
    ]);

    await deleteExpiredTokens();

    const remaining = async (
      table:
        | typeof challenges
        | typeof sessions
        | typeof recoveries
        | typeof invitations
        | typeof artistInvitations,
      candidates: string[],
    ) =>
      (
        await db
          .select({ id: table.id })
          .from(table)
          .where(inArray(table.id, candidates))
      )
        .map((row) => row.id)
        .sort();
    assert.deepEqual(
      await remaining(challenges, [challenge.expired, challenge.valid]),
      [challenge.valid],
    );
    assert.deepEqual(
      await remaining(sessions, [session.expired, session.valid]),
      [session.valid],
    );
    assert.deepEqual(
      await remaining(recoveries, [recovery.expired, recovery.valid]),
      [recovery.valid],
    );
    assert.deepEqual(
      await remaining(invitations, [
        invitation.expired,
        invitation.valid,
        used,
      ]),
      [invitation.valid, used].sort(),
    );
    assert.deepEqual(
      await remaining(artistInvitations, [
        artistInvitation.expired,
        artistInvitation.valid,
      ]),
      [artistInvitation.valid],
    );
  },
);

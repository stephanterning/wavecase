import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import { users, tracks, versions, sessions } from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { loader } from "../app/routes/library";

after(() => pool.end());

test(
  "library shows each owned track's newest uploaded version and status",
  { skip: !process.env.DATABASE_URL?.endsWith("/wavecase_test") },
  async () => {
    const owner = randomUUID();
    const other = randomUUID();
    const token = randomUUID();
    const track = randomUUID();
    const empty = randomUUID();
    const foreign = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Owner", email: `${owner}@test.invalid` },
      { id: other, name: "Other", email: `${other}@test.invalid` },
    ]);
    try {
      await db.insert(sessions).values({
        id: hash(token),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      await db.insert(tracks).values([
        { id: track, ownerId: owner, title: "Kiosken" },
        { id: empty, ownerId: owner, title: "Empty" },
        { id: foreign, ownerId: other, title: "Private" },
      ]);
      for (const version of [
        { trackId: track, name: "v5", status: "work in progress" },
        { trackId: track, name: "v5.1", status: "almost finished" },
        { trackId: foreign, name: "v99", status: "finished" },
      ]) {
        await db.insert(versions).values({ ...version, filename: "test.wav" });
      }
      const request = new Request(`${origin}/library`, {
        headers: { cookie: `session=${token}` },
      });
      const result = await loader({
        request,
        params: {},
        url: new URL(request.url),
        pattern: "/library",
        context: new RouterContextProvider(),
      });
      assert.equal(result.tracks.length, 2);
      const kiosken = result.tracks.find((row) => row.id === track)!;
      assert.equal(kiosken.latestVersion, "v5.1");
      assert.equal(kiosken.latestStatus, "almost finished");
      const unversioned = result.tracks.find((row) => row.id === empty)!;
      assert.equal(unversioned.latestVersion, null);
      assert.equal(unversioned.latestStatus, null);
    } finally {
      await db
        .delete(versions)
        .where(inArray(versions.trackId, [track, foreign]));
      await db
        .delete(tracks)
        .where(inArray(tracks.id, [track, empty, foreign]));
      await db.delete(sessions).where(eq(sessions.userId, owner));
      await db.delete(users).where(inArray(users.id, [owner, other]));
    }
  },
);

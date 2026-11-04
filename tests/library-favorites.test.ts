import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  tracks,
  versions,
  sessions,
  artists,
  artistMembers,
  trackFavorites,
  comments,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { loader, action } from "../app/routes/library";

after(() => pool.end());

test(
  "library counts retained versions and uses the latest successful upload across versions",
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
      const uploaded = new Date("2026-11-04T09:00:00Z");
      for (const version of [
        {
          trackId: track,
          name: "v5",
          status: "work in progress",
          state: "missing",
          uploadedAt: uploaded,
        },
        {
          trackId: track,
          name: "v5.1",
          status: "to finish",
          state: "ready",
          uploadedAt: new Date("2026-11-03T09:00:00Z"),
        },
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
      assert.equal(kiosken.latestStatus, "to finish");
      assert.equal(kiosken.favorite, false);
      assert.equal(kiosken.versionCount, 2);
      assert.equal(kiosken.updatedAt, uploaded.toISOString());
      const unversioned = result.tracks.find((row) => row.id === empty)!;
      assert.equal(unversioned.latestVersion, null);
      assert.equal(unversioned.latestStatus, null);
      assert.equal(unversioned.versionCount, 0);
      assert.equal(unversioned.updatedAt, null);

      const current = await db.query.versions.findFirst({
        where: eq(versions.trackId, track),
      });
      await db.insert(comments).values({
        versionId: current!.id,
        name: "Listener",
        body: "New feedback",
        createdAt: new Date("2026-11-05T09:00:00Z"),
      });
      await db
        .update(tracks)
        .set({ title: "Renamed" })
        .where(eq(tracks.id, track));
      await db
        .update(versions)
        .set({
          state: "missing",
          pendingUploadedAt: new Date("2026-11-06T09:00:00Z"),
        })
        .where(eq(versions.trackId, track));
      const unchanged = await loader({
        request,
        params: {},
        url: new URL(request.url),
        pattern: "/library",
        context: new RouterContextProvider(),
      });
      assert.equal(
        new Date(
          unchanged.tracks.find((r) => r.id === track)!.updatedAt!,
        ).getTime(),
        uploaded.getTime(),
      );
      assert.equal(
        unchanged.tracks.find((r) => r.id === track)!.versionCount,
        2,
      );
      await db.delete(comments).where(eq(comments.versionId, current!.id));
      await db.delete(versions).where(eq(versions.trackId, track));
      const deleted = await loader({
        request,
        params: {},
        url: new URL(request.url),
        pattern: "/library",
        context: new RouterContextProvider(),
      });
      assert.equal(deleted.tracks.find((r) => r.id === track)!.versionCount, 0);
      assert.equal(deleted.tracks.find((r) => r.id === track)!.updatedAt, null);
    } finally {
      await db
        .delete(comments)
        .where(
          inArray(
            comments.versionId,
            db
              .select({ id: versions.id })
              .from(versions)
              .where(eq(versions.trackId, track)),
          ),
        );
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

test(
  "favorites persist per account on shared demos and enforce current access and origin",
  { skip: !process.env.DATABASE_URL?.endsWith("/wavecase_test") },
  async () => {
    const accounts = [randomUUID(), randomUUID(), randomUUID()];
    const tokens = accounts.map(() => randomUUID());
    const artist = randomUUID(),
      shared = randomUUID(),
      personal = randomUUID();
    const args = (request: Request) => ({
      request,
      params: {},
      url: new URL(request.url),
      pattern: "/library",
      context: new RouterContextProvider(),
    });
    const get = (index: number) =>
      loader(
        args(
          new Request(`${origin}/library`, {
            headers: { cookie: `session=${tokens[index]}` },
          }),
        ),
      );
    const post = (
      index: number,
      trackId: string,
      favorite: string,
      requestOrigin = origin,
    ) =>
      action(
        args(
          new Request(`${origin}/library`, {
            method: "POST",
            headers: {
              origin: requestOrigin,
              cookie: `session=${tokens[index]}`,
            },
            body: new URLSearchParams({
              intent: "favorite",
              trackId,
              favorite,
              userId: accounts[2],
            }),
          }),
        ),
      );
    await db.insert(users).values(
      accounts.map((id, i) => ({
        id,
        name: "Owner",
        email: `${id}@test.invalid`,
        admin: i === 2,
      })),
    );
    try {
      await db.insert(sessions).values(
        accounts.map((userId, i) => ({
          id: hash(tokens[i]),
          userId,
          expires: new Date(Date.now() + 60000),
        })),
      );
      await db.insert(artists).values({
        id: artist,
        ownerId: accounts[0],
        name: "Shared",
        slug: artist,
      });
      await db.insert(artistMembers).values({
        artistId: artist,
        userId: accounts[1],
      });
      await db.insert(tracks).values([
        {
          id: shared,
          artistId: artist,
          ownerId: accounts[0],
          title: "Shared demo",
        },
        { id: personal, ownerId: accounts[0], title: "Personal demo" },
      ]);
      assert.deepEqual(await post(0, shared, "1"), { error: undefined });
      await post(0, shared, "1"); // Repeated submissions remain idempotent.
      assert.equal(
        (await get(0)).tracks.find((r) => r.id === shared)!.favorite,
        true,
      );
      assert.equal(
        (await get(1)).tracks.find((r) => r.id === shared)!.favorite,
        false,
      );
      await post(1, shared, "1");
      await post(0, shared, "0");
      assert.equal(
        (await get(0)).tracks.find((r) => r.id === shared)!.favorite,
        false,
      );
      assert.equal(
        (await get(1)).tracks.find((r) => r.id === shared)!.favorite,
        true,
      );
      assert.equal((await get(2)).tracks.length, 0);
      for (const [index, track] of [
        [2, shared],
        [1, personal],
      ] as const)
        await assert.rejects(
          post(index, track, "1"),
          (e) => e instanceof Response && e.status === 404,
        );
      await assert.rejects(
        post(0, shared, "1", "https://other.invalid"),
        (e) => e instanceof Response && e.status === 403,
      );
      for (const [trackId, favorite] of [
        ["invalid", "1"],
        [shared, "yes"],
      ]) {
        const result = await post(0, trackId, favorite);
        assert.ok("error" in result && result.error);
      }
      await assert.rejects(
        action(
          args(
            new Request(`${origin}/library`, {
              method: "POST",
              headers: { origin },
              body: new URLSearchParams({
                intent: "favorite",
                trackId: shared,
                favorite: "1",
              }),
            }),
          ),
        ),
        (e) => e instanceof Response && e.status === 401,
      );
      await db.delete(artistMembers).where(eq(artistMembers.artistId, artist));
      assert.equal((await get(1)).tracks.length, 0);
      await assert.rejects(
        post(1, shared, "0"),
        (e) => e instanceof Response && e.status === 404,
      );
      await db.delete(tracks).where(eq(tracks.id, shared));
      assert.equal(
        (
          await db
            .select()
            .from(trackFavorites)
            .where(eq(trackFavorites.trackId, shared))
        ).length,
        0,
      );
    } finally {
      await db.delete(tracks).where(inArray(tracks.id, [shared, personal]));
      await db.delete(artistMembers).where(eq(artistMembers.artistId, artist));
      await db.delete(artists).where(eq(artists.id, artist));
      await db.delete(sessions).where(inArray(sessions.userId, accounts));
      await db.delete(users).where(inArray(users.id, accounts));
    }
  },
);

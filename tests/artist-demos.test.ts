import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  artists,
  artistMembers,
  tracks,
  versions,
  sessions,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { loader as artistEditor } from "../app/routes/artist-edit";
import { loader as publicArtist } from "../app/routes/artist";
import { loader as library } from "../app/routes/library";
import { enabled } from "./database";

after(() => pool.end());

test(
  "artist demos share library playback while respecting profile membership and public privacy",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      member = randomUUID(),
      outsider = randomUUID();
    const artist = randomUUID(),
      otherArtist = randomUUID();
    const finished = randomUUID(),
      empty = randomUUID(),
      other = randomUUID();
    const unlinked = randomUUID(),
      foreign = randomUUID();
    const firstVersion = randomUUID(),
      latestPlayable = randomUUID();
    const missing = randomUUID(),
      otherVersion = randomUUID();
    const tokens = new Map<string, string>();
    const args = (user: string | null, id = artist) => {
      const request = new Request(origin, {
        headers: user ? { cookie: `session=${tokens.get(user)}` } : {},
      });
      return {
        request,
        params: { id, artist: id },
        url: new URL(request.url),
        pattern: "/artist-profiles/:id",
        context: new RouterContextProvider(),
      };
    };
    for (const id of [owner, member, outsider]) {
      await db.insert(users).values({
        id,
        name: id,
        email: `${id}@test.invalid`,
        admin: id === outsider,
      });
      const token = randomUUID();
      tokens.set(id, token);
      await db.insert(sessions).values({
        id: hash(token),
        userId: id,
        expires: new Date(Date.now() + 60000),
      });
    }
    try {
      await db.insert(artists).values([
        { id: artist, ownerId: owner, name: "Renamed artist", slug: artist },
        {
          id: otherArtist,
          ownerId: owner,
          name: "Another artist",
          slug: otherArtist,
        },
      ]);
      await db
        .insert(artistMembers)
        .values({ artistId: artist, userId: member });
      await db.insert(tracks).values([
        {
          id: finished,
          ownerId: member,
          artistId: artist,
          artist: "Old name",
          title: "Finished demo",
          cover: "private-cover",
        },
        { id: empty, ownerId: owner, artistId: artist, title: "No audio" },
        {
          id: other,
          ownerId: owner,
          artistId: otherArtist,
          title: "Other artist demo",
        },
        {
          id: unlinked,
          ownerId: owner,
          artist: "Renamed artist",
          title: "Free text demo",
        },
        {
          id: foreign,
          ownerId: outsider,
          artist: "Renamed artist",
          title: "Foreign demo",
        },
      ]);
      for (const [id, trackId, name, state] of [
        [firstVersion, finished, "v1", "ready"],
        [latestPlayable, finished, "v2", "ready"],
        [missing, finished, "v3", "missing"],
        [otherVersion, other, "Other v1", "ready"],
      ]) {
        await db.insert(versions).values({
          id,
          trackId,
          name,
          state,
          status: "finished",
          filename: "demo.wav",
          original: state === "ready" ? `private-source-${id}` : null,
          playback: state === "ready" ? `private-playback-${id}` : null,
          duration: 30,
        });
      }
      const ownerData = await artistEditor(args(owner));
      const memberData = await artistEditor(args(member));
      for (const data of [ownerData, memberData]) {
        assert.deepEqual(
          new Set(data.demos.tracks.map((t) => t.id)),
          new Set([finished, empty]),
        );
        const demo = data.demos.tracks.find((t) => t.id === finished)!;
        assert.equal(demo.artist, "Renamed artist");
        assert.equal(demo.latestVersion, "v3");
        assert.equal(demo.latestStatus, "finished");
        assert.equal(demo.cover, true);
        assert.deepEqual(
          data.demos.playable.map((v) => v.id),
          [latestPlayable],
        );
        assert.ok(
          data.demos.availableSources.includes(
            firstVersion + hash(`private-source-${firstVersion}`),
          ),
        );
        assert.ok(!JSON.stringify(data.demos).includes("private-source-"));
        assert.ok(!JSON.stringify(data.demos).includes("private-playback-"));
        assert.ok(!JSON.stringify(data.demos).includes("private-cover"));
      }
      // A filtered list must not revoke the other artist's active playback.
      assert.ok(
        ownerData.demos.availableSources.includes(
          otherVersion + hash(`private-source-${otherVersion}`),
        ),
      );
      assert.ok(
        !memberData.demos.availableSources.some((key) =>
          key.startsWith(otherVersion),
        ),
      );
      const all = await library(args(owner));
      assert.deepEqual(
        ownerData.demos.playable,
        all.playable.filter((v) => v.trackId === finished),
      );
      assert.deepEqual(ownerData.demos.availableSources, all.availableSources);
      assert.equal(
        all.tracks.find((t) => t.id === finished)?.artist,
        "Renamed artist",
      );
      await assert.rejects(
        artistEditor(args(outsider)),
        (error: unknown) => error instanceof Response && error.status === 404,
      );
      await assert.rejects(
        artistEditor(args(null)),
        (error: unknown) => error instanceof Response && error.status === 401,
      );
      const published = await publicArtist(args(null));
      assert.ok(!("demos" in published));
      assert.ok(!JSON.stringify(published).includes("Finished demo"));

      await db
        .update(tracks)
        .set({ artistId: otherArtist })
        .where(eq(tracks.id, finished));
      assert.deepEqual(
        (await artistEditor(args(owner))).demos.tracks.map((t) => t.id),
        [empty],
      );
      assert.ok(
        (await artistEditor(args(owner, otherArtist))).demos.tracks.some(
          (t) => t.id === finished,
        ),
      );
      assert.ok(
        !(await library(args(member))).availableSources.some((key) =>
          key.startsWith(latestPlayable),
        ),
      );
      await db
        .delete(artistMembers)
        .where(
          and(
            eq(artistMembers.artistId, artist),
            eq(artistMembers.userId, member),
          ),
        );
      await assert.rejects(
        artistEditor(args(member)),
        (error: unknown) => error instanceof Response && error.status === 404,
      );
    } finally {
      await db
        .delete(versions)
        .where(
          inArray(versions.trackId, [
            finished,
            empty,
            other,
            unlinked,
            foreign,
          ]),
        );
      await db
        .delete(tracks)
        .where(inArray(tracks.id, [finished, empty, other, unlinked, foreign]));
      await db
        .delete(artists)
        .where(inArray(artists.id, [artist, otherArtist]));
      await db
        .delete(sessions)
        .where(inArray(sessions.userId, [owner, member, outsider]));
      await db
        .delete(users)
        .where(inArray(users.id, [owner, member, outsider]));
    }
  },
);

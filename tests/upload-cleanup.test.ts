import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import { boss } from "../app/server/queue";
import {
  users,
  sessions,
  tracks,
  versions,
  artists,
  releases,
  releaseTracks,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { action as manage } from "../app/routes/manage";
import { action as editRelease } from "../app/routes/release-edit";
import { action as createTrack } from "../app/routes/library";
import { enabled } from "./database";

after(async () => {
  if (enabled) await boss.stop();
  await pool.end();
});
test(
  "uploads rejected by their transaction leave no stored file",
  { skip: !enabled },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-uploads-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    try {
      const owner = randomUUID(),
        session = randomUUID(),
        track = randomUUID(),
        version = randomUUID(),
        artist = randomUUID(),
        release = randomUUID(),
        releaseTrack = randomUUID();
      await db
        .insert(users)
        .values({ id: owner, name: "Owner", email: owner + "@test.invalid" });
      await db.insert(sessions).values({
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      await db
        .insert(tracks)
        .values({ id: track, ownerId: owner, title: "Uploads" });
      await db.insert(versions).values({
        id: version,
        trackId: track,
        name: "v1",
        filename: "processing.wav",
        pendingOriginal: "processing.wav",
      });
      await db
        .insert(artists)
        .values({ id: artist, ownerId: owner, name: "Artist", slug: artist });
      await db.insert(releases).values({
        id: release,
        artistId: artist,
        title: "Release",
        slug: release,
      });
      await db.insert(releaseTracks).values({
        id: releaseTrack,
        releaseId: release,
        title: "Track",
        position: 1,
        pendingOriginal: "processing.wav",
      });
      const post = (
        route: typeof manage | typeof editRelease,
        id: string,
        fields: Record<string, string>,
      ) => {
        const body = new FormData();
        body.set("_inline", "1");
        for (const [name, value] of Object.entries(fields))
          body.set(name, value);
        body.set("audio", new File(["RIFF upload"], "upload.wav"));
        return route({
          request: new Request(origin, {
            method: "POST",
            headers: { origin, cookie: "session=" + session },
            body,
          }),
          params: { id },
          context: new RouterContextProvider(),
          url: new URL(origin),
          pattern: "/",
        });
      };
      assert.deepEqual(
        await post(manage, track, { intent: "replace", version }),
        { error: "This version is already processing an upload" },
      );
      assert.deepEqual(
        await post(editRelease, release, {
          intent: "audio",
          track: releaseTrack,
        }),
        { error: "This track already has an upload processing." },
      );
      assert.deepEqual(await readdir(directory), []);
    } finally {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);
test(
  "new tracks stream their first version to disk and reject over-limit files without a track",
  { skip: !enabled },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-new-track-"));
    const previous = {
      DATA_DIR: process.env.DATA_DIR,
      MAX_UPLOAD_MB: process.env.MAX_UPLOAD_MB,
    };
    process.env.DATA_DIR = directory;
    process.env.MAX_UPLOAD_MB = "1";
    const owner = randomUUID(),
      session = randomUUID();
    await db
      .insert(users)
      .values({ id: owner, name: "Owner", email: owner + "@test.invalid" });
    try {
      await db.insert(sessions).values({
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      const create = (bytes: number) => {
        const body = new FormData();
        body.set("title", "New track");
        body.set("audio", new File([new Uint8Array(bytes).fill(7)], "a.wav"));
        return createTrack({
          request: new Request(origin + "/library", {
            method: "POST",
            headers: { origin, cookie: "session=" + session },
            body,
          }),
          params: {},
          context: new RouterContextProvider(),
          url: new URL(origin + "/library"),
          pattern: "/",
        });
      };
      const error = {
        error: "Choose an audio file within the upload size limit.",
      };
      assert.deepEqual(await create(1024 * 1024 + 1), error);
      assert.deepEqual(await create(2 * 1024 * 1024), error);
      assert.deepEqual(
        await db.select().from(tracks).where(eq(tracks.ownerId, owner)),
        [],
      );
      assert.deepEqual(await readdir(directory), []);

      const created = await create(1024 * 1024);
      assert.ok(created instanceof Response && created.status === 302);
      const [track] = await db
        .select()
        .from(tracks)
        .where(eq(tracks.ownerId, owner));
      const [version] = await db
        .select()
        .from(versions)
        .where(eq(versions.trackId, track.id));
      assert.equal(version.pendingOriginal, version.id);
      assert.deepEqual(await readdir(directory), [version.id]);
      const stored = await readFile(join(directory, version.id));
      assert.equal(stored.length, 1024 * 1024);
      assert.ok(stored.every((byte) => byte === 7));
    } finally {
      const owned = await db
        .select({ id: tracks.id })
        .from(tracks)
        .where(eq(tracks.ownerId, owner));
      for (const { id } of owned) {
        await db.delete(versions).where(eq(versions.trackId, id));
        await db.delete(tracks).where(eq(tracks.id, id));
      }
      await db.delete(sessions).where(eq(sessions.userId, owner));
      await db.delete(users).where(eq(users.id, owner));
      for (const [name, value] of Object.entries(previous))
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

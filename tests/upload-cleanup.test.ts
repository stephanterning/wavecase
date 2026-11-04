import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
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
import { enabled } from "./database";

after(() => pool.end());
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

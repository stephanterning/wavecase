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
  links,
  events,
  sessions,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { loader } from "../app/routes/track";

after(() => pool.end());
test(
  "share link play totals include all versions and disabled links, exclude other activity, and stay private",
  { skip: !process.env.DATABASE_URL?.endsWith("/wavecase_test") },
  async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      track = randomUUID(),
      foreign = randomUUID(),
      session = randomUUID();
    const active = randomUUID(),
      disabled = randomUUID(),
      empty = randomUUID(),
      privateLink = randomUUID();
    const linkIds = [active, disabled, empty, privateLink];
    await db.insert(users).values([
      { id: owner, name: "Owner", email: `${owner}@test.invalid` },
      { id: other, name: "Other", email: `${other}@test.invalid` },
    ]);
    try {
      await db.insert(sessions).values({
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      await db.insert(tracks).values([
        { id: track, ownerId: owner, title: "Demo" },
        { id: foreign, ownerId: other, title: "Private" },
      ]);
      const uploaded = await db
        .insert(versions)
        .values([
          { trackId: track, name: "v5", filename: "v5.wav", state: "missing" },
          {
            trackId: track,
            name: "v5.1",
            filename: "v5.1.wav",
            state: "missing",
          },
        ])
        .returning();
      await db.insert(links).values([
        { id: active, trackId: track, label: "Active" },
        { id: disabled, trackId: track, label: "Disabled", active: false },
        { id: empty, trackId: track, label: "Empty" },
        { id: privateLink, trackId: foreign, label: "Other owner" },
      ]);
      await db.insert(events).values(
        [
          { linkId: active, kind: "play", versionId: uploaded[0].id },
          { linkId: active, kind: "play", versionId: uploaded[1].id },
          { linkId: active, kind: "play", versionId: uploaded[1].id },
          { linkId: active, kind: "visit" },
          { linkId: active, kind: "pause" },
          { linkId: active, kind: "download-started" },
          { linkId: disabled, kind: "play", versionId: uploaded[0].id },
          { linkId: privateLink, kind: "play" },
        ].map((event) => ({ ...event, browser: "test", session: "test" })),
      );
      const args = (
        url: string,
        params: Record<string, string>,
        authenticated = false,
      ) => ({
        request: new Request(url, {
          headers: authenticated ? { cookie: `session=${session}` } : {},
        }),
        params,
        url: new URL(url),
        pattern: "/",
        context: new RouterContextProvider(),
      });
      const data = await loader(
        args(`${origin}/tracks/${track}`, { id: track }, true),
      );
      assert.deepEqual(
        Object.fromEntries(data.links.map((link) => [link.id, link.plays])),
        { [active]: 3, [disabled]: 1, [empty]: 0 },
      );
      assert.deepEqual(
        Object.fromEntries(data.links.map((link) => [link.id, link.downloads])),
        { [active]: 1, [disabled]: 0, [empty]: 0 },
      );
      const listener = await loader(
        args(`${origin}/s/${active}`, { share: active }),
      );
      assert.deepEqual(listener.links, []);
      const preview = await loader(
        args(`${origin}/s/${active}?preview=1`, { share: active }, true),
      );
      assert.deepEqual(preview.links, []);
      await assert.rejects(
        loader(args(`${origin}/tracks/${foreign}`, { id: foreign }, true)),
        (error) => error instanceof Response && error.status === 404,
      );
    } finally {
      await db.delete(events).where(inArray(events.linkId, linkIds));
      await db.delete(links).where(inArray(links.id, linkIds));
      await db.delete(versions).where(eq(versions.trackId, track));
      await db.delete(tracks).where(inArray(tracks.id, [track, foreign]));
      await db.delete(sessions).where(eq(sessions.userId, owner));
      await db.delete(users).where(inArray(users.id, [owner, other]));
    }
  },
);

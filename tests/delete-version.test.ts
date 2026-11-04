import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq, inArray } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  artists,
  artistMembers,
  tracks,
  versions,
  links,
  comments,
  events,
  reuploadRequests,
  sessions,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { versionAccess } from "../app/server/access";
import { action, loader } from "../app/routes/track";
import { dashboard } from "../app/server/dashboard";
import { enabled } from "./database";
import { formFailure } from "./form-failure";

after(() => pool.end());
test(
  "version deletion cleans only that version, respects shared ownership, and preserves link boundaries through future uploads",
  { skip: !enabled },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-delete-version-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    const owner = randomUUID(),
      coowner = randomUUID(),
      outsider = randomUUID(),
      artist = randomUUID(),
      track = randomUUID(),
      foreign = randomUUID(),
      link = randomUUID(),
      all = randomUUID(),
      pinned = randomUUID();
    const accounts = [owner, coowner, outsider];
    const tokens = accounts.map(() => randomUUID());
    const args = (request: Request, params: Record<string, string>) => ({
      request,
      params,
      url: new URL(request.url),
      pattern: "/",
      context: new RouterContextProvider(),
    });
    const post = (fields: Record<string, string>, token = tokens[0]) =>
      action(
        args(
          new Request(`${origin}/tracks/${track}`, {
            method: "POST",
            headers: { origin, cookie: `session=${token}` },
            body: new URLSearchParams({ _inline: "1", ...fields }),
          }),
          { id: track },
        ),
      );
    const listener = (share = link) =>
      loader(args(new Request(`${origin}/s/${share}`), { share }));
    await db.insert(users).values(
      accounts.map((id) => ({
        id,
        name: "Test owner",
        email: `${id}@test.invalid`,
        admin: id === outsider,
      })),
    );
    try {
      await db.insert(sessions).values(
        accounts.map((id, i) => ({
          id: hash(tokens[i]),
          userId: id,
          expires: new Date(Date.now() + 60000),
        })),
      );
      await db.insert(artists).values({
        id: artist,
        ownerId: owner,
        name: "Shared artist",
        slug: artist,
      });
      await db.insert(tracks).values([
        {
          id: track,
          ownerId: owner,
          artistId: artist,
          title: "Demo",
          cover: "cover.jpg",
        },
        { id: foreign, ownerId: outsider, title: "Private" },
      ]);
      const [older, target, newer, foreignVersion] = await db
        .insert(versions)
        .values([
          { trackId: track, name: "v1", filename: "old.wav", state: "missing" },
          {
            trackId: track,
            name: "v2",
            filename: "source.wav",
            state: "ready",
            original: "source",
            playback: "playback.wav",
            pendingOriginal: "pending",
          },
          { trackId: track, name: "v3", filename: "new.wav", state: "missing" },
          {
            trackId: foreign,
            name: "Private",
            filename: "private.wav",
            original: "foreign",
          },
        ])
        .returning();
      await db.insert(links).values([
        {
          id: link,
          trackId: track,
          label: "Onward",
          fromOrder: target.position,
        },
        { id: all, trackId: track, label: "All versions" },
        {
          id: pinned,
          trackId: track,
          label: "Pinned",
          pinnedOrder: target.position,
        },
      ]);
      const thread = randomUUID();
      await db.insert(comments).values([
        {
          id: thread,
          versionId: target.id,
          linkId: link,
          name: "Listener",
          body: "Delete feedback",
        },
        {
          versionId: target.id,
          linkId: link,
          threadId: thread,
          name: "Owner",
          body: "Delete reply",
          owner: true,
        },
        {
          versionId: target.id,
          name: "Owner",
          body: "Delete internal discussion",
          authorId: owner,
          owner: true,
        },
        {
          versionId: newer.id,
          linkId: all,
          name: "Listener",
          body: "Keep feedback",
        },
      ]);
      await db.insert(events).values([
        {
          versionId: target.id,
          linkId: link,
          kind: "play",
          browser: "b",
          session: "s",
        },
        {
          versionId: target.id,
          linkId: all,
          kind: "download-started",
          browser: "b",
          session: "s",
        },
        {
          versionId: newer.id,
          linkId: all,
          kind: "play",
          browser: "b",
          session: "s",
        },
        { linkId: link, kind: "visit", browser: "b", session: "s" },
      ]);
      // Reupload requests belong to the track/link, rather than one version.
      await db
        .insert(reuploadRequests)
        .values({ trackId: track, linkId: link });
      const removed = [
        "source",
        "source.mp3",
        "source.mp3.tmp",
        "source.export.wav",
        "source.16-44100.wav",
        "source.16-44100.wav.tmp",
        "source.16-44100.flac",
        "source.16-44100.flac.tmp",
        "playback.wav",
        "playback.wav.mp3",
        "playback.wav.stream-v1.flac",
        "playback.wav.stream-v1.json",
        "source.mp3.stream-v1.json",
        "source.stream-v1.pcm.tmp",
        "pending",
        "pending.wav",
      ];
      await Promise.all(
        [...removed, "cover.jpg", "foreign"].map((file) =>
          writeFile(join(directory, file), "fixture"),
        ),
      );
      const deletion = {
        intent: "delete-version",
        version: target.id,
        confirmation: target.name,
      };
      for (const token of [tokens[1], tokens[2]])
        await assert.rejects(
          post(deletion, token),
          (e) => e instanceof Response && e.status === 404,
        );
      for (const fields of [
        { ...deletion, confirmation: "" },
        { ...deletion, confirmation: "V2" },
        {
          ...deletion,
          version: foreignVersion.id,
          confirmation: foreignVersion.name,
        },
      ]) {
        assert.ok(formFailure(await post(fields)).error);
      }
      assert.equal((await readdir(directory)).length, removed.length + 2);
      await db
        .insert(artistMembers)
        .values({ artistId: artist, userId: coowner });
      assert.deepEqual(await post(deletion, tokens[1]), { saved: true });
      assert.equal(
        await db.query.versions.findFirst({
          where: eq(versions.id, target.id),
        }),
        undefined,
      );
      assert.equal(
        (
          await db
            .select()
            .from(comments)
            .where(eq(comments.versionId, target.id))
        ).length,
        0,
      );
      assert.equal(
        (await db.select().from(events).where(eq(events.versionId, target.id)))
          .length,
        0,
      );
      assert.deepEqual((await readdir(directory)).sort(), [
        "cover.jpg",
        "foreign",
      ]);
      assert.deepEqual((await listener(pinned)).versions, []);
      assert.equal(
        (await db.select().from(events).where(eq(events.linkId, link))).length,
        1,
      );
      const totals = await dashboard(owner, "all");
      assert.equal(totals.demo.plays, 1);
      assert.equal(totals.demo.downloads, 0);
      assert.equal(totals.demo.feedback, 1);
      assert.equal(
        (await db.query.links.findFirst({ where: eq(links.id, link) }))
          ?.fromOrder,
        target.position,
      );
      assert.ok(
        await db.query.reuploadRequests.findFirst({
          where: eq(reuploadRequests.linkId, link),
        }),
      );
      assert.equal(
        (
          await db.query.versions.findFirst({
            where: eq(versions.id, older.id),
          })
        )?.position,
        older.position,
      );
      assert.equal(
        (
          await db.query.versions.findFirst({
            where: eq(versions.id, newer.id),
          })
        )?.position,
        newer.position,
      );
      assert.deepEqual(
        (await listener()).versions.map((v) => v.id),
        [newer.id],
      );
      for (const headers of [
        new Headers(),
        new Headers({ cookie: `session=${tokens[0]}` }),
      ])
        await assert.rejects(
          versionAccess(
            new Request(`${origin}/media/${target.id}`, { headers }),
            target.id,
            link,
          ),
          (e) => e instanceof Response && e.status === 404,
        );
      assert.deepEqual(
        await post({
          intent: "link",
          link,
          label: "Renamed link",
          active: "on",
          from: "unchanged",
        }),
        { saved: true },
      );
      assert.equal(
        (await db.query.links.findFirst({ where: eq(links.id, link) }))
          ?.fromOrder,
        target.position,
      );
      assert.deepEqual(
        await post({
          ...deletion,
          version: newer.id,
          confirmation: newer.name,
        }),
        { saved: true },
      );
      assert.deepEqual(
        await post({
          intent: "link",
          link: pinned,
          label: "Pinned renamed",
          active: "on",
          visibility: "single",
          from: "unchanged",
        }),
        { saved: true },
      );
      assert.equal(
        (await db.query.links.findFirst({ where: eq(links.id, pinned) }))
          ?.pinnedOrder,
        target.position,
      );
      assert.deepEqual((await listener(pinned)).versions, []);
      assert.deepEqual((await listener()).versions, []);
      const [future] = await db
        .insert(versions)
        .values({
          trackId: track,
          name: "v4",
          filename: "future.wav",
          state: "missing",
        })
        .returning();
      assert.deepEqual(
        (await listener()).versions.map((v) => v.id),
        [future.id],
      );
      assert.deepEqual((await listener(pinned)).versions, []);
      // Deleting the last version leaves the demo ready for another upload.
      for (const version of [future, older])
        assert.deepEqual(
          await post({
            ...deletion,
            version: version.id,
            confirmation: version.name,
          }),
          { saved: true },
        );
      const empty = await loader(
        args(
          new Request(`${origin}/tracks/${track}`, {
            headers: { cookie: `session=${tokens[0]}` },
          }),
          { id: track },
        ),
      );
      assert.deepEqual(empty.versions, []);
      assert.equal(empty.track.cover, true);
      assert.equal(empty.links.length, 3);
      assert.deepEqual((await listener()).versions, []);
      assert.ok(
        await db.query.versions.findFirst({
          where: eq(versions.id, foreignVersion.id),
        }),
      );
    } finally {
      await db
        .delete(reuploadRequests)
        .where(eq(reuploadRequests.trackId, track));
      await db
        .delete(events)
        .where(inArray(events.linkId, [link, all, pinned]));
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
      await db.delete(links).where(eq(links.trackId, track));
      await db
        .delete(versions)
        .where(inArray(versions.trackId, [track, foreign]));
      await db.delete(tracks).where(inArray(tracks.id, [track, foreign]));
      await db.delete(artistMembers).where(eq(artistMembers.artistId, artist));
      await db.delete(artists).where(eq(artists.id, artist));
      await db.delete(sessions).where(inArray(sessions.userId, accounts));
      await db.delete(users).where(inArray(users.id, accounts));
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

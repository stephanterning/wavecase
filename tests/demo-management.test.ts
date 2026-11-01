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
  tracks,
  versions,
  links,
  comments,
  events,
  reuploadRequests,
  sessions,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { action } from "../app/routes/manage";
import { dashboard } from "../app/server/dashboard";
import { loader } from "../app/routes/track";
import { loader as analytics } from "../app/routes/analytics";

after(() => pool.end());
test(
  "scoped demo editors preserve other fields; deleting links and tracks removes only their content and files",
  { skip: !process.env.DATABASE_URL?.endsWith("/wavecase_test") },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-delete-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    const owner = randomUUID(),
      other = randomUUID(),
      token = randomUUID(),
      outsider = randomUUID();
    const track = randomUUID(),
      foreign = randomUUID(),
      version = randomUUID(),
      foreignVersion = randomUUID();
    const link = randomUUID(),
      keep = randomUUID(),
      foreignLink = randomUUID();
    const args = (request: Request, id = track) => ({
      request,
      params: { id },
      url: new URL(request.url),
      pattern: "/",
      context: new RouterContextProvider(),
    });
    const post = (
      fields: Record<string, string>,
      id = track,
      session = token,
    ) =>
      action(
        args(
          new Request(`${origin}/tracks/${id}/manage`, {
            method: "POST",
            headers: { origin, cookie: `session=${session}` },
            body: new URLSearchParams({ _inline: "1", ...fields }),
          }),
          id,
        ),
      );
    await db.insert(users).values([
      { id: owner, name: "Owner", email: `${owner}@test.invalid` },
      { id: other, name: "Other", email: `${other}@test.invalid`, admin: true },
    ]);
    try {
      await db.insert(sessions).values([
        {
          id: hash(token),
          userId: owner,
          expires: new Date(Date.now() + 60000),
        },
        {
          id: hash(outsider),
          userId: other,
          expires: new Date(Date.now() + 60000),
        },
      ]);
      await db.insert(tracks).values([
        {
          id: track,
          ownerId: owner,
          title: "Demo",
          artist: "Original artist",
          description: "Track description",
          cover: "cover.jpg",
        },
        { id: foreign, ownerId: other, title: "Other" },
      ]);
      await db.insert(versions).values([
        {
          id: version,
          trackId: track,
          name: "v5",
          filename: "test.wav",
          status: "to finish",
          download: true,
          description: "Version description",
          state: "ready",
          original: "master",
          playback: "playback",
          pendingOriginal: "pending",
        },
        {
          id: foreignVersion,
          trackId: foreign,
          name: "Other",
          filename: "other.wav",
          original: "other-master",
        },
      ]);
      await db.insert(links).values([
        { id: link, trackId: track, label: "Delete me", fromOrder: 1 },
        { id: keep, trackId: track, label: "Keep me" },
        { id: foreignLink, trackId: foreign, label: "Foreign" },
      ]);
      await writeFile(join(directory, "cover.jpg"), "test cover");
      await assert.rejects(
        post({ intent: "remove-cover" }, track, outsider),
        (error: unknown) => error instanceof Response && error.status === 404,
      );
      assert.deepEqual(await post({ intent: "remove-cover" }), { saved: true });
      assert.equal(
        (await db.query.tracks.findFirst({ where: eq(tracks.id, track) }))
          ?.cover,
        null,
      );
      assert.ok(!(await readdir(directory)).includes("cover.jpg"));
      await db
        .update(tracks)
        .set({ cover: "cover.jpg" })
        .where(eq(tracks.id, track));
      const thread = randomUUID();
      await db.insert(comments).values([
        {
          id: thread,
          versionId: version,
          linkId: link,
          name: "Listener",
          body: "Feedback",
        },
        {
          threadId: thread,
          versionId: version,
          linkId: link,
          name: "Owner",
          owner: true,
          body: "Reply",
        },
        {
          versionId: version,
          linkId: keep,
          name: "Keep",
          body: "Other feedback",
        },
      ]);
      await db.insert(events).values([
        {
          linkId: link,
          versionId: version,
          kind: "play",
          browser: "b",
          session: "s",
        },
        {
          linkId: link,
          versionId: version,
          kind: "download-started",
          browser: "b",
          session: "s",
        },
        {
          linkId: keep,
          versionId: version,
          kind: "play",
          browser: "b",
          session: "s",
        },
      ]);
      await db
        .insert(reuploadRequests)
        .values({ linkId: link, trackId: track });
      const files = [
        "cover.jpg",
        "master",
        "master.mp3",
        "master.export.wav",
        "playback",
        "pending",
        "pending.wav",
        "other-master",
      ];
      await Promise.all(
        files.map((file) => writeFile(join(directory, file), "fixture")),
      );

      assert.deepEqual(
        await post({ intent: "metadata", field: "title", title: "Renamed" }),
        { saved: true },
      );
      const updated = await db.query.tracks.findFirst({
        where: eq(tracks.id, track),
      });
      assert.equal(updated?.artist, "Original artist");
      assert.equal(updated?.description, "Track description");
      assert.deepEqual(
        await post({ intent: "version", version, field: "name", name: "v5.1" }),
        { saved: true },
      );
      let current = await db.query.versions.findFirst({
        where: eq(versions.id, version),
      });
      assert.equal(current?.description, "Version description");
      assert.equal(current?.download, true);
      assert.equal(current?.status, "to finish");
      assert.deepEqual(
        await post({
          intent: "version",
          version,
          field: "settings",
          status: "finished",
        }),
        { saved: true },
      );
      current = await db.query.versions.findFirst({
        where: eq(versions.id, version),
      });
      assert.equal(current?.name, "v5.1");
      assert.equal(current?.description, "Version description");
      assert.equal(current?.download, false);

      await assert.rejects(
        post(
          { intent: "delete-track", confirmation: "Renamed" },
          track,
          outsider,
        ),
        (e) => e instanceof Response && e.status === 404,
      );
      const wrong = await post({
        intent: "delete-track",
        confirmation: "Wrong title",
      });
      assert.ok(!(wrong instanceof Response) && "error" in wrong);
      const forbiddenLink = await post({
        intent: "delete-link",
        link: foreignLink,
        confirm: "delete",
      });
      assert.ok(
        !(forbiddenLink instanceof Response) && "error" in forbiddenLink,
      );
      assert.ok(
        await db.query.links.findFirst({ where: eq(links.id, foreignLink) }),
      );

      assert.deepEqual(
        await post({ intent: "delete-link", link, confirm: "delete" }),
        { saved: true },
      );
      assert.equal(
        (await db.select().from(comments).where(eq(comments.linkId, link)))
          .length,
        0,
      );
      assert.equal(
        (await db.select().from(events).where(eq(events.linkId, link))).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(reuploadRequests)
            .where(eq(reuploadRequests.linkId, link))
        ).length,
        0,
      );
      assert.ok(
        await db.query.comments.findFirst({ where: eq(comments.linkId, keep) }),
      );
      const activity = await analytics(
        args(
          new Request(`${origin}/tracks/${track}/analytics`, {
            headers: { cookie: `session=${token}` },
          }),
        ),
      );
      const totals = await dashboard(owner, "all");
      assert.equal(totals.demo.plays, 1);
      assert.equal(totals.demo.downloads, 0);
      assert.equal(totals.demo.feedback, 1);
      assert.equal(activity.events.length, 1);
      assert.equal(activity.events[0].event.linkId, keep);
      await assert.rejects(
        loader({
          ...args(new Request(`${origin}/s/${link}`)),
          params: { share: link },
        }),
        (e) => e instanceof Response && e.status === 404,
      );

      const deleted = await post({
        intent: "delete-track",
        confirmation: "Renamed",
      });
      assert.ok(deleted instanceof Response);
      assert.equal(deleted.headers.get("location"), "/library");
      assert.equal(
        await db.query.tracks.findFirst({ where: eq(tracks.id, track) }),
        undefined,
      );
      assert.equal(
        await db.query.versions.findFirst({ where: eq(versions.id, version) }),
        undefined,
      );
      assert.equal(
        (await db.select().from(links).where(eq(links.trackId, track))).length,
        0,
      );
      assert.equal(
        (
          await db
            .select()
            .from(comments)
            .where(eq(comments.versionId, version))
        ).length,
        0,
      );
      assert.equal(
        (await db.select().from(events).where(eq(events.versionId, version)))
          .length,
        0,
      );
      assert.deepEqual(await readdir(directory), ["other-master"]);
      assert.ok(
        await db.query.tracks.findFirst({ where: eq(tracks.id, foreign) }),
      );
      await assert.rejects(
        loader({
          ...args(new Request(`${origin}/s/${keep}`)),
          params: { share: keep },
        }),
        (e) => e instanceof Response && e.status === 404,
      );
    } finally {
      await db
        .delete(reuploadRequests)
        .where(eq(reuploadRequests.trackId, track));
      await db
        .delete(events)
        .where(inArray(events.linkId, [link, keep, foreignLink]));
      await db
        .delete(comments)
        .where(inArray(comments.linkId, [link, keep, foreignLink]));
      await db
        .delete(links)
        .where(inArray(links.id, [link, keep, foreignLink]));
      await db
        .delete(versions)
        .where(inArray(versions.id, [version, foreignVersion]));
      await db.delete(tracks).where(inArray(tracks.id, [track, foreign]));
      await db.delete(sessions).where(inArray(sessions.userId, [owner, other]));
      await db.delete(users).where(inArray(users.id, [owner, other]));
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

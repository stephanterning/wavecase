import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  artists,
  releases,
  tracks,
  versions,
  links,
  comments,
  events,
  releaseEvents,
  sessions,
} from "../app/server/schema";
import { dashboard } from "../app/server/dashboard";
import { hash, origin } from "../app/server/security";
import { action as createArtist } from "../app/routes/artist-profiles";
import {
  action as editArtist,
  loader as artistEditor,
} from "../app/routes/artist-edit";
import { action as createRelease } from "../app/routes/releases";
import { enabled } from "./database";
after(() => pool.end());
test(
  "dashboard periods, feedback, current inventory and administrator owner isolation",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      artist = randomUUID(),
      release = randomUUID(),
      track = randomUUID(),
      version = randomUUID(),
      link = randomUUID();
    const now = new Date("2026-11-01T12:00:00Z"),
      boundary = new Date(now.getTime() - 30 * 86400000);
    await db.insert(users).values([
      { id: owner, name: "Admin", email: owner + "@test.invalid", admin: true },
      { id: other, name: "Other", email: other + "@test.invalid" },
    ]);
    await db
      .insert(artists)
      .values({ id: artist, ownerId: owner, name: "Artist", slug: artist });
    await db.insert(releases).values({
      id: release,
      artistId: artist,
      title: "Release",
      slug: release,
      published: true,
    });
    await db
      .insert(tracks)
      .values({ id: track, ownerId: owner, title: "Demo" });
    await db.insert(versions).values({
      id: version,
      trackId: track,
      name: "v1",
      filename: "test.wav",
    });
    await db.insert(links).values({ id: link, trackId: track, label: "Test" });
    await db.insert(comments).values([
      {
        versionId: version,
        linkId: link,
        name: "Listener",
        body: "At boundary",
        createdAt: boundary,
      },
      {
        versionId: version,
        linkId: link,
        name: "Listener",
        body: "Reply",
        threadId: randomUUID(),
        createdAt: now,
      },
      {
        versionId: version,
        linkId: link,
        name: "Owner",
        body: "Exclude",
        owner: true,
        createdAt: now,
      },
      {
        versionId: version,
        linkId: link,
        name: "Deleted",
        body: null,
        createdAt: now,
      },
    ]);
    await db.insert(events).values(
      [boundary, new Date(boundary.getTime() - 1)].map((createdAt) => ({
        versionId: version,
        linkId: link,
        browser: "test",
        session: "test",
        kind: "play",
        createdAt,
      })),
    );
    await db
      .insert(releaseEvents)
      .values({ releaseId: release, kind: "download-started", createdAt: now });
    const d = await dashboard(owner, "30", now);
    assert.equal(d.demo.plays, 1);
    assert.equal(d.demo.feedback, 2);
    assert.equal(d.feedback.length, 2);
    assert.equal(d.demo.links, 1);
    assert.equal(d.release.downloads, 1);
    assert.equal(d.inventory.published, 1);
    assert.equal((await dashboard(owner, "all", now)).demo.plays, 2);
    assert.equal((await dashboard(owner, "7", now)).demo.feedback, 1);
    assert.equal((await dashboard(owner, "invalid", now)).period, "30");
    const empty = await dashboard(other, "all", now);
    assert.equal(empty.demo.plays, 0);
    assert.equal(empty.inventory.demos, 0);
    assert.equal(empty.feedback.length, 0);
    assert.equal(empty.recent.length, 0);
  },
);
test(
  "artist and release forms preserve ownership and stable public addresses",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      token = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Owner", email: owner + "@test.invalid" },
      { id: other, name: "Other", email: other + "@test.invalid" },
    ]);
    await db.insert(sessions).values({
      id: hash(token),
      userId: owner,
      expires: new Date(Date.now() + 60000),
    });
    const args = (values: Record<string, string | File>, id?: string) => {
      const f = new FormData();
      Object.entries(values).forEach(([k, v]) => f.set(k, v));
      return {
        request: new Request(origin, {
          method: "POST",
          headers: { origin, cookie: `session=${token}` },
          body: f,
        }),
        params: id ? { id } : {},
        url: new URL(origin),
        pattern: "/",
        context: new RouterContextProvider(),
      };
    };
    const created = await createArtist(
      args({ name: "New artist", slug: "test-" + owner }),
    );
    assert.ok(created instanceof Response);
    const id = created.headers.get("location")!.split("/").at(-1)!;
    assert.ok(
      (await editArtist(
        args(
          {
            intent: "edit-artist",
            name: "Renamed",
            bio: "Biography",
            links: "Website | https://example.com",
          },
          id,
        ),
      )) instanceof Response,
    );
    const loaded = await artistEditor(args({}, id));
    assert.equal(loaded.artist.name, "Renamed");
    assert.equal(loaded.artist.slug, "test-" + owner);
    const media = await mkdtemp(join(tmpdir(), "wavecase-artist-test-"));
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = media;
    try {
      const input = join(media, "fixture.png");
      await promisify(execFile)("ffmpeg", [
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=blue:s=16x16",
        "-frames:v",
        "1",
        input,
      ]);
      const image = new File([await readFile(input)], "fixture.png", {
        type: "image/png",
      });
      assert.ok(
        (await editArtist(
          args({ intent: "artist-image", image }, id),
        )) instanceof Response,
      );
      const first = (await artistEditor(args({}, id))).artist.image!;
      assert.ok(
        (await editArtist(
          args({ intent: "artist-image", image }, id),
        )) instanceof Response,
      );
      const second = (await artistEditor(args({}, id))).artist.image!;
      assert.notEqual(first, second);
      await assert.rejects(stat(join(media, first)));
      assert.ok((await stat(join(media, second))).size > 0);
    } finally {
      if (previousDataDir === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previousDataDir;
      await rm(media, { recursive: true, force: true });
    }
    const foreign = randomUUID();
    await db
      .insert(artists)
      .values({ id: foreign, ownerId: other, name: "Foreign", slug: foreign });
    await assert.rejects(artistEditor(args({}, foreign)));
    const rejected = await editArtist(
      args({ intent: "edit-artist", name: "Unauthorized" }, foreign),
    );
    assert.ok(!(rejected instanceof Response) && rejected.error);
    const release = await createRelease(
      args({
        intent: "release",
        artist: id,
        name: "New release",
        kind: "single",
        slug: "test-release",
      }),
    );
    assert.ok(release instanceof Response);
    assert.match(release.headers.get("location")!, /^\/releases\//);
    const denied = await createRelease(
      args({
        intent: "release",
        artist: foreign,
        name: "Denied",
        kind: "single",
      }),
    );
    assert.ok(!(denied instanceof Response) && denied.error);
  },
);

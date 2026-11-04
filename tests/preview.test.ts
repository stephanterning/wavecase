import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  sessions,
  tracks,
  versions,
  links,
  comments,
  artists,
  releases,
  events,
  releaseEvents,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { versionAccess } from "../app/server/access";
import {
  loader as feedback,
  action as sendFeedback,
} from "../app/routes/feedback";
import { action as media } from "../app/routes/media";
import { action as releaseAssets } from "../app/routes/release-assets";
import { action as telemetry } from "../app/routes/events";
import { commentTime, parseCommentTime } from "../app/domain/comment-time";
import { enabled } from "./database";
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { loader: demo } = await import("../app/routes/track");
const { loader: releasePage } = await import("../app/routes/release-page");
const { action: shareAction } = await import("../app/routes/share");
after(() => pool.end());
const args = (request: Request, params: Record<string, string>) => ({
  request,
  params,
  context: new RouterContextProvider(),
  url: new URL(request.url),
  pattern: "/",
});
const status = (code: number) => (error: unknown) =>
  error instanceof Response && error.status === code;

test("comment times preserve hundredths and reject invalid minutes:seconds", () => {
  assert.equal(commentTime(180), "3:00");
  assert.equal(commentTime(180.97), "3:00.97");
  assert.equal(commentTime(59.999), "1:00");
  assert.equal(parseCommentTime("3:00.97"), 180.97);
  for (const value of ["180", "1:60", "-1:10", "1:2", "1:00.123", "Infinity"])
    assert.ok(Number.isNaN(parseCommentTime(value)));
});

test(
  "owner preview follows share permissions and never accepts feedback, downloads or telemetry",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      session = randomUUID(),
      outsider = randomUUID(),
      track = randomUUID(),
      share = randomUUID(),
      otherShare = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Preview owner", email: `${owner}@example.test` },
      {
        id: other,
        name: "Other admin",
        email: `${other}@example.test`,
        admin: true,
      },
    ]);
    await db.insert(sessions).values([
      {
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 3600000),
      },
      {
        id: hash(outsider),
        userId: other,
        expires: new Date(Date.now() + 3600000),
      },
    ]);
    await db
      .insert(tracks)
      .values({ id: track, ownerId: owner, title: "Preview demo" });
    const [old] = await db
      .insert(versions)
      .values({
        trackId: track,
        name: "Old",
        filename: "old.wav",
        state: "ready",
        original: "old.wav",
      })
      .returning();
    const [latest] = await db
      .insert(versions)
      .values({
        trackId: track,
        name: "Latest",
        filename: "latest.wav",
        state: "ready",
        original: "latest.wav",
        download: true,
      })
      .returning();
    await db.insert(links).values([
      {
        id: share,
        trackId: track,
        label: "Recipient",
        fromOrder: latest.position,
      },
      { id: otherShare, trackId: track, label: "Another recipient" },
    ]);
    await db.insert(comments).values([
      { versionId: latest.id, linkId: share, name: "A", body: "Visible" },
      {
        versionId: latest.id,
        linkId: otherShare,
        name: "B",
        body: "Private to another link",
      },
    ]);
    const request = (
      path: string,
      cookie: string | undefined = session,
      method = "GET",
    ) =>
      new Request(origin + path, {
        method,
        headers: { origin, ...(cookie ? { cookie: `session=${cookie}` } : {}) },
      });
    const preview = await demo(
      args(request(`/s/${share}?preview=1`), { share }),
    );
    assert.equal(preview.owner, false);
    assert.equal(preview.preview, true);
    assert.deepEqual(
      preview.versions.map((v) => v.id),
      [latest.id],
    );
    assert.equal(preview.versions[0].canDownload, false);
    assert.deepEqual(preview.links, []);
    assert.deepEqual(preview.artists, []);
    const normal = await demo(args(request(`/tracks/${track}`), { id: track }));
    assert.equal(normal.owner, true);
    assert.equal(normal.versions.length, 2);
    for (const cookie of ["", outsider])
      await assert.rejects(
        demo(args(request(`/s/${share}?preview=1`, cookie), { share })),
        status(404),
      );
    await assert.rejects(
      versionAccess(
        request(`/media/${old.id}?share=${share}&preview=1`),
        old.id,
        share,
      ),
      status(404),
    );
    const feedbackResult = await feedback(
      args(request(`/feedback/${latest.id}?share=${share}&preview=1`), {
        id: latest.id,
      }),
    );
    const rows = await feedbackResult.json();
    assert.deepEqual(
      rows.map((r: { body: string }) => r.body),
      ["Visible"],
    );
    assert.equal(rows[0].canDelete, false);
    for (const [action, path, params] of [
      [
        sendFeedback,
        `/feedback/${latest.id}?share=${share}&preview=1`,
        { id: latest.id },
      ],
      [media, `/media/${latest.id}?preview=1`, { id: latest.id }],
      [telemetry, `/events/${latest.id}?preview=1`, { id: latest.id }],
      [shareAction, `/s/${share}?preview=1`, { share }],
    ] as const)
      await assert.rejects(
        action(args(request(path, session, "POST"), params)),
        status(403),
      );
    assert.equal(
      (await db.select().from(events).where(eq(events.linkId, share))).length,
      0,
    );
    await db.update(links).set({ download: true }).where(eq(links.id, share));
    assert.equal(
      (await demo(args(request(`/s/${share}?preview=1`), { share })))
        .versions[0].canDownload,
      true,
    );
    await db.update(links).set({ active: false }).where(eq(links.id, share));
    await assert.rejects(
      demo(args(request(`/s/${share}?preview=1`), { share })),
      status(404),
    );

    const artist = randomUUID(),
      release = randomUUID();
    await db
      .insert(artists)
      .values({ id: artist, ownerId: owner, name: "Artist", slug: artist });
    await db
      .insert(releases)
      .values({ id: release, artistId: artist, title: "Draft", slug: "draft" });
    const draft = await releasePage(
      args(request(`/artists/${artist}/draft?preview=1`), {
        artist,
        release: "draft",
      }),
    );
    assert.equal(draft.preview, true);
    assert.equal(draft.release.published, false);
    await assert.rejects(
      releasePage(
        args(request(`/artists/${artist}/draft?preview=1`, outsider), {
          artist,
          release: "draft",
        }),
      ),
      status(404),
    );
    await assert.rejects(
      releaseAssets(
        args(
          request(
            `/release-assets/${release}/download?preview=1`,
            session,
            "POST",
          ),
          { id: release, kind: "download" },
        ),
      ),
      status(403),
    );
    // Public preview navigation can reach releases owned by another artist.
    await db
      .update(releases)
      .set({ published: true })
      .where(eq(releases.id, release));
    const publicPreview = await releasePage(
      args(request(`/artists/${artist}/draft?preview=1`, ""), {
        artist,
        release: "draft",
      }),
    );
    assert.equal(publicPreview.preview, true);
    assert.equal(publicPreview.owner, false);
    assert.equal(
      (
        await db
          .select()
          .from(releaseEvents)
          .where(eq(releaseEvents.releaseId, release))
      ).length,
      0,
    );
  },
);

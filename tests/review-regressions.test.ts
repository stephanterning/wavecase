import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  tracks,
  versions,
  links,
  sessions,
  events,
  comments,
  reuploadRequests,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
const modules = enabled
  ? {
      track: await import("../app/routes/track"),
      feedback: await import("../app/routes/feedback"),
      activity: await import("../app/routes/events"),
      share: await import("../app/routes/share"),
      manage: await import("../app/routes/manage"),
      analytics: await import("../app/routes/analytics"),
    }
  : null;
after(async () => {
  await pool.end();
});
const args = (request: Request, params: Record<string, string>) => ({
  request,
  params,
  context: new RouterContextProvider(),
  url: new URL(request.url),
  pattern: "test",
});
test(
  "link creation preserves missing-version boundaries; visits, names, retries and reupload requests keep their proper context",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      track = randomUUID(),
      empty = randomUUID(),
      old = randomUUID(),
      missing = randomUUID(),
      session = randomUUID();
    const cookie = "session=" + session;
    const post = (
      path: string,
      body: FormData | object,
      authenticated = false,
    ) =>
      new Request(origin + path, {
        method: "POST",
        headers: {
          origin,
          ...(authenticated ? { cookie } : {}),
          ...(body instanceof FormData
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body: body instanceof FormData ? body : JSON.stringify(body),
      });
    const linkForm = (visibility: string) => {
      const form = new FormData();
      form.set("intent", "link");
      form.set("label", "Review link");
      form.set("visibility", visibility);
      return form;
    };
    await db
      .insert(users)
      .values({
        id: owner,
        name: "Review owner",
        email: owner + "@test.invalid",
      });
    await db
      .insert(sessions)
      .values({
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
    await db.insert(tracks).values([
      { id: track, ownerId: owner, title: "Review" },
      { id: empty, ownerId: owner, title: "Empty" },
    ]);
    const trackIds = [track, empty];
    try {
      await db
        .insert(versions)
        .values({
          id: old,
          trackId: track,
          name: "v1",
          filename: "v1.wav",
          state: "ready",
          duration: 60,
        });
      await db
        .insert(versions)
        .values({
          id: missing,
          trackId: track,
          name: "v2",
          filename: "v2.wav",
          state: "missing",
          duration: 60,
        });
      await modules!.track.action(
        args(post("/tracks/" + track, linkForm("onward"), true), { id: track }),
      );
      const link = (await db.query.links.findFirst({
        where: eq(links.trackId, track),
      }))!;
      const view = await modules!.track.loader(
        args(new Request(origin + "/s/" + link.id), { share: link.id }),
      );
      assert.deepEqual(
        view.versions.map((v) => v.id),
        [missing],
      );
      const future = randomUUID();
      await db
        .insert(versions)
        .values({
          id: future,
          trackId: track,
          name: "v3",
          filename: "v3.wav",
          state: "ready",
          duration: 60,
        });
      assert.deepEqual(
        (
          await modules!.track.loader(
            args(new Request(origin + "/s/" + link.id), { share: link.id }),
          )
        ).versions.map((v) => v.id),
        [future, missing],
      );
      await db
        .update(versions)
        .set({ state: "missing" })
        .where(eq(versions.id, future));
      await modules!.track.action(
        args(post("/tracks/" + track, linkForm("onward"), true), { id: track }),
      );
      const restricted = await db.query.links.findMany({
        where: eq(links.trackId, track),
      });
      assert.ok(restricted.every((l) => l.fromOrder !== null));
      const rejected = await modules!.track.action(
        args(post("/tracks/" + empty, linkForm("onward"), true), { id: empty }),
      );
      assert.ok("error" in rejected);
      assert.equal(
        (await db.query.links.findMany({ where: eq(links.trackId, empty) }))
          .length,
        0,
      );
      await modules!.track.action(
        args(post("/tracks/" + empty, linkForm("all"), true), { id: empty }),
      );
      const emptyLink = (await db.query.links.findFirst({
        where: eq(links.trackId, empty),
      }))!;
      const browser = randomUUID(),
        listenerSession = randomUUID();
      const event = {
        id: randomUUID(),
        browser,
        session: listenerSession,
        name: null,
        kind: "visit",
        position: 0,
        referrer: "https://example.org/private?secret=1",
      };
      const visit = () =>
        modules!.activity.action(
          args(post("/visits/" + emptyLink.id, event), { share: emptyLink.id }),
        );
      await visit();
      await visit();
      const visits = await db.query.events.findMany({
        where: eq(events.linkId, emptyLink.id),
      });
      assert.equal(visits.length, 1);
      assert.equal(visits[0].versionId, null);
      assert.equal(
        (visits[0].context as { referrer: string }).referrer,
        "https://example.org",
      );
      await modules!.activity.action(
        args(
          post("/visits/" + emptyLink.id, { ...event, id: randomUUID() }, true),
          { share: emptyLink.id },
        ),
      );
      assert.equal(
        (
          await db.query.events.findMany({
            where: eq(events.linkId, emptyLink.id),
          })
        ).length,
        1,
      );
      await modules!.activity.action(
        args(
          post("/events/" + missing + "?share=" + link.id, {
            ...event,
            id: randomUUID(),
            kind: "interval",
            end: 30,
          }),
          { id: missing },
        ),
      );
      await modules!.feedback.action(
        args(
          post("/feedback/" + missing + "?share=" + link.id, {
            browser,
            name: "Listener",
            secret: "s".repeat(64),
            body: "A comment",
            start: 1,
            end: null,
          }),
          { id: missing },
        ),
      );
      assert.equal(
        (await db.query.events.findFirst({
          where: eq(events.linkId, link.id),
        }))!.name,
        "Listener",
      );
      assert.equal(
        (await db.query.events.findFirst({
          where: eq(events.linkId, emptyLink.id),
        }))!.name,
        null,
      );
      const request = new FormData();
      request.set("name", "Listener");
      assert.deepEqual(
        await modules!.share.action(
          args(post("/s/" + link.id, request), { share: link.id }),
        ),
        { requested: true },
      );
      assert.equal(
        (await db.query.reuploadRequests.findFirst({
          where: eq(reuploadRequests.linkId, link.id),
        }))!.name,
        "Listener",
      );
      const analytics = await modules!.analytics.loader(
        args(
          new Request(origin + "/tracks/" + empty + "/analytics", {
            headers: { cookie },
          }),
          { id: empty },
        ),
      );
      assert.equal(analytics.events.length, 1);
      assert.equal(analytics.events[0].version, null);
      const clear = new FormData();
      clear.set("intent", "clear-analytics");
      await modules!.manage.action(
        args(post("/tracks/" + empty + "/manage", clear, true), { id: empty }),
      );
      assert.equal(
        (
          await db.query.events.findMany({
            where: eq(events.linkId, emptyLink.id),
          })
        ).length,
        0,
      );
      assert.equal(
        (await db.query.events.findMany({ where: eq(events.linkId, link.id) }))
          .length,
        1,
      );
      await db
        .update(links)
        .set({ active: false })
        .where(eq(links.id, link.id));
      await assert.rejects(
        modules!.activity.action(
          args(post("/visits/" + link.id, event), { share: link.id }),
        ),
        (e) => e instanceof Response && e.status === 404,
      );
    } finally {
      const linkIds = db
        .select({ id: links.id })
        .from(links)
        .where(inArray(links.trackId, trackIds));
      await db.delete(events).where(inArray(events.linkId, linkIds));
      await db.delete(comments).where(inArray(comments.linkId, linkIds));
      await db
        .delete(reuploadRequests)
        .where(inArray(reuploadRequests.trackId, trackIds));
      await db.delete(links).where(inArray(links.trackId, trackIds));
      await db.delete(versions).where(inArray(versions.trackId, trackIds));
      await db.delete(tracks).where(inArray(tracks.id, trackIds));
      await db.delete(sessions).where(eq(sessions.userId, owner));
      await db
        .delete(users)
        .where(and(eq(users.id, owner), eq(users.name, "Review owner")));
    }
  },
);

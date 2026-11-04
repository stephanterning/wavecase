import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import { users, sessions, tracks, versions, links } from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { enabled } from "./database";
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { loader: demo } = await import("../app/routes/track");
const { loader: status } = await import("../app/routes/track-status");
after(() => pool.end());
const args = (request: Request, params: Record<string, string>) => ({
  request,
  params,
  context: new RouterContextProvider(),
  url: new URL(request.url),
  pattern: "/",
});
const notFound = (error: unknown) =>
  error instanceof Response && error.status === 404;

test(
  "status polls follow share page access and expose only a fingerprint of the visible page",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      outsider = randomUUID(),
      session = randomUUID(),
      outsiderSession = randomUUID(),
      track = randomUUID(),
      pinned = randomUUID(),
      onward = randomUUID(),
      inactive = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Status owner", email: `${owner}@example.test` },
      { id: outsider, name: "Outsider", email: `${outsider}@example.test` },
    ]);
    await db.insert(sessions).values(
      [
        [session, owner],
        [outsiderSession, outsider],
      ].map(([id, userId]) => ({
        id: hash(id),
        userId,
        expires: new Date(Date.now() + 3600000),
      })),
    );
    await db
      .insert(tracks)
      .values({ id: track, ownerId: owner, title: "Status demo" });
    const version = async (name: string, state = "ready") =>
      (
        await db
          .insert(versions)
          .values({
            trackId: track,
            name,
            filename: `${name}.wav`,
            state,
            original: state === "ready" ? `${name}.wav` : null,
            metadata: { audioPolicy: 3, wavDownload: false },
            peaks: [0.5, 1],
          })
          .returning()
      )[0];
    const first = await version("First");
    await db.insert(links).values([
      {
        id: pinned,
        trackId: track,
        label: "Pinned",
        pinnedOrder: first.position,
      },
      { id: onward, trackId: track, label: "Onward" },
      { id: inactive, trackId: track, label: "Off", active: false },
    ]);
    const request = (path: string, cookie?: string) =>
      new Request(origin + path, {
        headers: cookie ? { cookie: `session=${cookie}` } : {},
      });
    const poll = async (
      path: string,
      params: Record<string, string>,
      cookie?: string,
    ) => {
      const response = await status(args(request(path, cookie), params));
      assert.equal(response.headers.get("Cache-Control"), "private, no-store");
      const body = await response.json();
      assert.deepEqual(Object.keys(body), ["fingerprint"]);
      return body.fingerprint as string;
    };
    const share = (link: string, cookie?: string, preview = false) => {
      const path = `/s/${link}${preview ? "?preview=1" : ""}`;
      const statusPath = `/s/${link}/status${preview ? "?preview=1" : ""}`;
      return Promise.all([
        demo(args(request(path, cookie), { share: link })),
        poll(statusPath, { share: link }, cookie),
      ]);
    };

    const [pinnedPage, pinnedStatus] = await share(pinned);
    assert.equal(pinnedStatus, pinnedPage.fingerprint);
    assert.deepEqual(
      pinnedPage.versions.map((v) => v.id),
      [first.id],
    );

    const second = await version("Second");
    await db
      .update(versions)
      .set({
        filename: "renamed.wav",
        error: "Internal detail",
        pendingOriginal: "replacement.wav",
      })
      .where(eq(versions.id, first.id));
    assert.equal(
      await poll(`/s/${pinned}/status`, { share: pinned }),
      pinnedStatus,
      "versions outside the pin and owner-only fields must not change the listener fingerprint",
    );
    await db
      .update(versions)
      .set({ name: "First (edited)" })
      .where(eq(versions.id, first.id));
    assert.notEqual(
      await poll(`/s/${pinned}/status`, { share: pinned }),
      pinnedStatus,
    );

    const [onwardPage, onwardStatus] = await share(onward);
    assert.equal(onwardStatus, onwardPage.fingerprint);
    assert.deepEqual(
      onwardPage.versions.map((v) => v.id),
      [second.id, first.id],
    );
    const processing = await version("Third", "processing");
    assert.equal(
      await poll(`/s/${onward}/status`, { share: onward }),
      onwardStatus,
    );
    await db
      .update(versions)
      .set({ state: "ready", original: "third.wav" })
      .where(eq(versions.id, processing.id));
    const ready = await poll(`/s/${onward}/status`, { share: onward });
    assert.notEqual(ready, onwardStatus);
    const [readyPage] = await share(onward);
    assert.equal(readyPage.fingerprint, ready);
    assert.deepEqual(readyPage.versions[0].peaks, [0.5, 1]);

    for (const cookie of [undefined, session])
      await assert.rejects(
        poll(`/s/${inactive}/status`, { share: inactive }, cookie),
        notFound,
      );
    await db.update(links).set({ active: false }).where(eq(links.id, pinned));
    await assert.rejects(
      poll(`/s/${pinned}/status`, { share: pinned }),
      notFound,
    );

    const [previewPage, previewStatus] = await share(onward, session, true);
    assert.equal(previewPage.owner, false);
    assert.equal(previewStatus, previewPage.fingerprint);
    for (const cookie of [undefined, outsiderSession])
      await assert.rejects(
        poll(`/s/${onward}/status?preview=1`, { share: onward }, cookie),
        notFound,
      );

    for (const cookie of [undefined, outsiderSession])
      await assert.rejects(
        poll(`/tracks/${track}/status`, { id: track }, cookie),
        notFound,
      );
    const ownerPage = await demo(
      args(request(`/tracks/${track}`, session), { id: track }),
    );
    const ownerStatus = await poll(
      `/tracks/${track}/status`,
      { id: track },
      session,
    );
    assert.equal(ownerStatus, ownerPage.fingerprint);
    await db
      .update(versions)
      .set({ pendingOriginal: null })
      .where(eq(versions.id, first.id));
    assert.notEqual(
      await poll(`/tracks/${track}/status`, { id: track }, session),
      ownerStatus,
      "owners keep polling until replacement processing finishes",
    );
  },
);

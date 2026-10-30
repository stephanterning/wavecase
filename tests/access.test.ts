import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loader as media } from "../app/routes/media";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, pool } from "../app/server/db";
import {
  users,
  tracks,
  versions,
  links,
  sessions,
  comments,
} from "../app/server/schema";
import { versionAccess } from "../app/server/access";
import { hash, origin, sameOrigin } from "../app/server/security";
import { loader as feedback, action as comment } from "../app/routes/feedback";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
after(async () => pool.end());
test("cross-origin mutations are rejected", () =>
  assert.throws(() =>
    sameOrigin(
      new Request(origin, { headers: { origin: "https://attacker.example" } }),
    ),
  ));
test(
  "owner isolation, onward links, inactive links and comment boundaries",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      stranger = randomUUID(),
      track = randomUUID(),
      old = randomUUID(),
      latest = randomUUID(),
      session = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Owner", email: owner + "@test.invalid" },
      {
        id: stranger,
        name: "Other admin",
        email: stranger + "@test.invalid",
        admin: true,
      },
    ]);
    await db
      .insert(tracks)
      .values({ id: track, ownerId: owner, title: "Private track" });
    await db.insert(versions).values([
      {
        id: old,
        trackId: track,
        name: "Old",
        filename: "old.wav",
        state: "ready",
        createdAt: new Date("2025-01-01"),
        duration: 10,
      },
      {
        id: latest,
        trackId: track,
        name: "New",
        filename: "new.wav",
        state: "ready",
        createdAt: new Date("2025-02-01"),
        duration: 10,
      },
    ]);
    const a = randomUUID(),
      b = randomUUID(),
      off = randomUUID();
    await db.insert(links).values([
      { id: a, trackId: track, label: "A" },
      {
        id: b,
        trackId: track,
        label: "B",
        fromOrder: (await db.query.versions.findFirst({
          where: eq(versions.id, latest),
        }))!.position,
      },
      { id: off, trackId: track, label: "Disabled", active: false },
    ]);
    const request = new Request(origin);
    await assert.rejects(
      versionAccess(request, latest),
      (e) => e instanceof Response && e.status === 404,
    );
    assert.equal((await versionAccess(request, latest, a)).owner, false);
    await assert.rejects(versionAccess(request, old, b));
    await assert.rejects(versionAccess(request, latest, off));
    await db.insert(sessions).values({
      id: hash(session),
      userId: stranger,
      expires: new Date(Date.now() + 60000),
    });
    await assert.rejects(
      versionAccess(
        new Request(origin, { headers: { cookie: "session=" + session } }),
        latest,
      ),
    );
    const root = randomUUID();
    await db.insert(comments).values({
      id: root,
      versionId: latest,
      linkId: a,
      name: "Anna",
      body: "Only link A",
      secretHash: hash("a".repeat(64)),
    });
    const response = await feedback({
      request: new Request(origin + "?share=" + b),
      params: { id: latest },
      context: new RouterContextProvider(),
      url: new URL(origin),
      pattern: "/feedback/:id",
    });
    assert.deepEqual(await response.json(), []);
    await assert.rejects(
      comment({
        request: new Request(origin + "?share=" + b, {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Bob",
            body: "Cross-link reply",
            secret: "b".repeat(64),
            threadId: root,
            start: null,
            end: null,
          }),
        }),
        params: { id: latest },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/feedback/:id",
      }),
    );

    const args = {
      params: { id: latest },
      context: new RouterContextProvider(),
      url: new URL(origin),
      pattern: "/feedback/:id",
    };
    const postComment = (body: unknown) =>
      comment({
        ...args,
        request: new Request(origin + "?share=" + a, {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
      });
    await postComment({
      name: "Anna",
      body: "A reply",
      secret: "a".repeat(64),
      threadId: root,
      start: null,
      end: null,
    });
    await assert.rejects(postComment({ delete: root, secret: "b".repeat(64) }));
    await postComment({ delete: root, secret: "a".repeat(64) });
    assert.equal(
      (await db.query.comments.findFirst({ where: eq(comments.id, root) }))
        ?.body,
      null,
    );
    const reply = await db.query.comments.findFirst({
      where: eq(comments.threadId, root),
    });
    await postComment({ delete: reply!.id, secret: "a".repeat(64) });
    assert.equal(
      await db.query.comments.findFirst({ where: eq(comments.id, reply!.id) }),
      undefined,
    );
    const directory = await mkdtemp(join(tmpdir(), "wavecase-media-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    try {
      await writeFile(join(directory, "audio"), "0123456789");
      await db
        .update(versions)
        .set({ original: "audio", playback: "audio", download: true })
        .where(eq(versions.id, latest));
      const get = (query: string, headers: Record<string, string> = {}) =>
        media({
          ...args,
          request: new Request(origin + "?share=" + a + query, { headers }),
        });
      await assert.rejects(
        get("&download=1"),
        (e) => e instanceof Response && e.status === 403,
      );
      await db.update(links).set({ download: true }).where(eq(links.id, a));
      assert.equal(await (await get("&download=1")).text(), "0123456789");
      const partial = await get("", { range: "bytes=2-5" });
      assert.equal(partial.status, 206);
      assert.equal(await partial.text(), "2345");
      assert.equal((await get("", { range: "bytes=20-" })).status, 416);
      const full = await get("");
      await full.arrayBuffer();
      const etag = full.headers.get("etag")!;
      assert.equal((await get("", { "if-none-match": etag })).status, 304);
      await db.update(links).set({ active: false }).where(eq(links.id, a));
      await assert.rejects(
        get("", { "if-none-match": etag }),
        (e) => e instanceof Response && e.status === 404,
      );
    } finally {
      process.env.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

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
  comments,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { loader, action as create } from "../app/routes/track";
import { action as manage } from "../app/routes/manage";
import { versionAccess } from "../app/server/access";
import { loader as media, action as download } from "../app/routes/media";
import { loader as feedback, action as comment } from "../app/routes/feedback";
import { enabled } from "./database";

after(() => pool.end());
test(
  "specific-version links stay pinned through uploads, missing audio, restoration and edits",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      track = randomUUID(),
      foreign = randomUUID(),
      session = randomUUID();
    const args = (request: Request, params: Record<string, string>) => ({
      request,
      params,
      url: new URL(request.url),
      pattern: "/",
      context: new RouterContextProvider(),
    });
    const post = (
      path: string,
      values: Record<string, string>,
      authenticated = true,
    ) =>
      new Request(`${origin}${path}`, {
        method: "POST",
        headers: {
          origin,
          ...(authenticated ? { cookie: `session=${session}` } : {}),
        },
        body: new URLSearchParams(values),
      });
    const denied = (error: unknown) =>
      error instanceof Response && error.status === 404;
    await db
      .insert(users)
      .values({ id: owner, name: "Owner", email: `${owner}@test.invalid` });
    try {
      await db
        .insert(sessions)
        .values({
          id: hash(session),
          userId: owner,
          expires: new Date(Date.now() + 60000),
        });
      await db.insert(tracks).values([
        { id: track, ownerId: owner, title: "Pinned demo" },
        { id: foreign, ownerId: owner, title: "Another demo" },
      ]);
      const [old, selected, pending, other] = await db
        .insert(versions)
        .values([
          { trackId: track, name: "v1", filename: "one.wav", state: "ready" },
          {
            trackId: track,
            name: "v2",
            filename: "two.wav",
            state: "ready",
            download: true,
          },
          {
            trackId: track,
            name: "Pending",
            filename: "pending.wav",
            state: "processing",
          },
          {
            trackId: foreign,
            name: "Other",
            filename: "other.wav",
            state: "ready",
          },
        ])
        .returning();
      const createLink = (from: string, visibility = "single") =>
        create(
          args(
            post(`/tracks/${track}`, {
              intent: "link",
              label: "Fixed version",
              visibility,
              from,
              download: "on",
            }),
            { id: track },
          ),
        );
      for (const invalid of [
        "",
        randomUUID(),
        "invalid",
        pending.id,
        other.id,
      ]) {
        assert.ok("error" in (await createLink(invalid)));
      }
      assert.ok("error" in (await createLink(selected.id, "unknown")));
      assert.equal(
        (await db.query.links.findMany({ where: eq(links.trackId, track) }))
          .length,
        0,
      );
      assert.deepEqual(await createLink(selected.id), { ok: true });
      const link = (await db.query.links.findFirst({
        where: eq(links.trackId, track),
      }))!;
      assert.equal(link.pinnedOrder, selected.position);
      assert.equal(link.fromOrder, null);
      const read = (preview = false) =>
        loader(
          args(
            new Request(
              `${origin}/s/${link.id}${preview ? "?preview=1" : ""}`,
              {
                headers: preview ? { cookie: `session=${session}` } : {},
              },
            ),
            { share: link.id },
          ),
        );
      assert.deepEqual(
        (await read()).versions.map((v) => v.id),
        [selected.id],
      );
      const [future] = await db
        .insert(versions)
        .values({
          trackId: track,
          name: "v3",
          filename: "three.wav",
          state: "ready",
        })
        .returning();
      for (const preview of [false, true]) {
        assert.deepEqual(
          (await read(preview)).versions.map((v) => v.id),
          [selected.id],
        );
      }
      assert.equal(
        (await versionAccess(new Request(origin), selected.id, link.id)).version
          .id,
        selected.id,
      );
      for (const hidden of [old, future, pending, other]) {
        await assert.rejects(
          versionAccess(new Request(origin), hidden.id, link.id),
          denied,
        );
        for (const query of ["", "&download-info=1"]) {
          await assert.rejects(
            media(
              args(
                new Request(
                  `${origin}/media/${hidden.id}?share=${link.id}${query}`,
                  {
                    headers: {
                      range: "bytes=0-1",
                      "if-none-match": '"cached"',
                    },
                  },
                ),
                { id: hidden.id },
              ),
            ),
            denied,
          );
        }
        await assert.rejects(
          media(
            args(
              new Request(`${origin}/media/${hidden.id}?share=${link.id}`, {
                method: "HEAD",
              }),
              { id: hidden.id },
            ),
          ),
          denied,
        );
        await assert.rejects(
          download(
            args(
              post(
                `/media/${hidden.id}`,
                {
                  share: link.id,
                  format: "original",
                  email: "listener@test.invalid",
                },
                false,
              ),
              { id: hidden.id },
            ),
          ),
          denied,
        );
        await assert.rejects(
          feedback(
            args(
              new Request(`${origin}/feedback/${hidden.id}?share=${link.id}`),
              { id: hidden.id },
            ),
          ),
          denied,
        );
        await assert.rejects(
          comment(
            args(
              new Request(`${origin}/feedback/${hidden.id}?share=${link.id}`, {
                method: "POST",
                headers: { origin, "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: "Listener",
                  body: "Hidden",
                  secret: "a".repeat(32),
                  start: null,
                  end: null,
                }),
              }),
              { id: hidden.id },
            ),
          ),
          denied,
        );
      }
      await db
        .insert(comments)
        .values({
          versionId: selected.id,
          linkId: link.id,
          name: "Listener",
          body: "Keep this feedback",
        });
      await db
        .update(versions)
        .set({ state: "missing" })
        .where(eq(versions.id, selected.id));
      assert.deepEqual(
        (await read()).versions.map((v) => [v.id, v.state]),
        [[selected.id, "missing"]],
      );
      const retained = await feedback(
        args(
          new Request(`${origin}/feedback/${selected.id}?share=${link.id}`),
          { id: selected.id },
        ),
      );
      assert.equal((await retained.json())[0].body, "Keep this feedback");
      await db
        .update(versions)
        .set({ state: "ready", name: "Renamed version" })
        .where(eq(versions.id, selected.id));
      assert.deepEqual(
        (await read()).versions.map((v) => v.name),
        ["Renamed version"],
      );
      const edit = (visibility: string, from = "", active = true) =>
        manage(
          args(
            post(`/tracks/${track}/manage`, {
              intent: "link",
              link: link.id,
              label: "Edited",
              visibility,
              from,
              _inline: "1",
              ...(active ? { active: "on" } : {}),
            }),
            { id: track },
          ),
        );
      assert.ok("error" in (await edit("single", other.id)));
      assert.deepEqual(
        (await read()).versions.map((v) => v.id),
        [selected.id],
      );
      assert.deepEqual(await edit("onward", selected.id), { saved: true });
      assert.deepEqual(
        (await read()).versions.map((v) => v.id),
        [future.id, selected.id],
      );
      assert.deepEqual(await edit("all"), { saved: true });
      assert.deepEqual(
        (await read()).versions.map((v) => v.id),
        [future.id, selected.id, old.id],
      );
      assert.deepEqual(await edit("single", old.id), { saved: true });
      assert.deepEqual(
        (await read()).versions.map((v) => v.id),
        [old.id],
      );
      await edit("single", old.id, false);
      await assert.rejects(read(), denied);
      await assert.rejects(
        versionAccess(new Request(origin), old.id, link.id),
        denied,
      );
      await edit("single", old.id);
      assert.deepEqual(
        (await read()).versions.map((v) => v.id),
        [old.id],
      );
    } finally {
      const trackIds = [track, foreign];
      const ownedVersions = db
        .select({ id: versions.id })
        .from(versions)
        .where(inArray(versions.trackId, trackIds));
      await db
        .delete(comments)
        .where(inArray(comments.versionId, ownedVersions));
      await db.delete(links).where(inArray(links.trackId, trackIds));
      await db.delete(versions).where(inArray(versions.trackId, trackIds));
      await db.delete(tracks).where(inArray(tracks.id, trackIds));
      await db.delete(sessions).where(eq(sessions.userId, owner));
      await db.delete(users).where(eq(users.id, owner));
    }
  },
);

test(
  "share link play totals include all versions and disabled links, exclude other activity, and stay private",
  { skip: !enabled },
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

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  createMemoryRouter,
  RouterProvider,
  RouterContextProvider,
} from "react-router";
import { db, pool } from "../app/server/db";
import { users, artists, tracks, links, sessions } from "../app/server/schema";
import { resolveTrackArtist } from "../app/server/track-artist";
import { hash, origin } from "../app/server/security";
import { loader as artistPage } from "../app/routes/artist";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { default: DemoPage, loader: demoPage } =
  await import("../app/routes/track");
const { action: createTrack } = await import("../app/routes/library");
const { action: manageTrack } = await import("../app/routes/manage");
after(() => pool.end());
const form = (values: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(values)) f.set(k, v);
  return f;
};
const args = (request: Request, params: Record<string, string>) => ({
  request,
  params,
  url: new URL(request.url),
  pattern: "/",
  context: new RouterContextProvider(),
});

test(
  "demo artist links are owner-scoped, stable on rename, optional, and private",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      other = randomUUID(),
      artist = randomUUID(),
      foreign = randomUUID(),
      token = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Owner", email: owner + "@test.invalid" },
      { id: other, name: "Other", email: other + "@test.invalid" },
    ]);
    await db.insert(artists).values([
      {
        id: artist,
        ownerId: owner,
        name: "Martin Dice",
        slug: `martin-${artist}`,
      },
      {
        id: foreign,
        ownerId: other,
        name: "Martin Dice",
        slug: `martin-${foreign}`,
      },
    ]);
    await db
      .insert(sessions)
      .values({
        id: hash(token),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
    assert.deepEqual(
      await resolveTrackArtist(owner, form({ artist: "  mArTiN dIcE\t" })),
      { artistId: artist, artist: "Martin Dice" },
    );
    await assert.rejects(
      resolveTrackArtist(owner, form({ artistId: foreign })),
      (e) => e instanceof Response && e.status === 400,
    );
    assert.deepEqual(
      await resolveTrackArtist(owner, form({ artist: "Unlisted Artist" })),
      { artistId: null, artist: "Unlisted Artist" },
    );
    const post = (values: Record<string, string>) =>
      new Request(origin, {
        method: "POST",
        headers: { origin, cookie: `session=${token}` },
        body: form(values),
      });
    const response = await createTrack(
      args(post({ title: "Private demo", artist: "martin dice" }), {}),
    );
    assert.ok(response instanceof Response);
    const trackId = response.headers.get("location")!.split("/").at(-1)!;
    assert.equal(
      (await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) }))!
        .artistId,
      artist,
    );
    const share = randomUUID();
    await db
      .insert(links)
      .values({ id: share, trackId, label: "Private preview" });
    const listener = new Request(origin);
    const linked = await demoPage(args(listener, { share }));
    const router = createMemoryRouter(
      [{ id: "demo", path: "/", Component: DemoPage }],
      { hydrationData: { loaderData: { demo: linked } } },
    );
    try {
      assert.ok(
        renderToStaticMarkup(
          createElement(RouterProvider, { router }),
        ).includes(`href="/artists/martin-${artist}"`),
      );
    } finally {
      router.dispose();
    }
    assert.equal(linked.artistUrl, `/artists/martin-${artist}`);
    assert.equal(linked.track.artist, "Martin Dice");
    assert.deepEqual(linked.artists, []);
    const publicArtist = await artistPage(
      args(listener, { artist: `martin-${artist}` }),
    );
    assert.equal(publicArtist.releases.length, 0);
    await assert.rejects(
      demoPage(args(listener, { id: trackId })),
      (e) => e instanceof Response && e.status === 404,
    );
    await db
      .update(artists)
      .set({ name: "New artist name" })
      .where(eq(artists.id, artist));
    const renamed = await demoPage(args(listener, { share }));
    assert.equal(renamed.artistUrl, linked.artistUrl);
    assert.equal(renamed.track.artist, "New artist name");
    await manageTrack(
      args(
        post({
          intent: "metadata",
          title: "Private demo",
          artistId: artist,
          description: "",
        }),
        { id: trackId },
      ),
    );
    assert.equal(
      (await db.query.tracks.findFirst({ where: eq(tracks.id, trackId) }))!
        .artistId,
      artist,
    );
    await manageTrack(
      args(
        post({
          intent: "metadata",
          title: "Private demo",
          artist: "Free name",
          description: "",
        }),
        { id: trackId },
      ),
    );
    const free = await demoPage(args(listener, { share }));
    assert.equal(free.artistUrl, null);
    assert.equal(free.track.artist, "Free name");
    await manageTrack(
      args(
        post({
          intent: "metadata",
          title: "Private demo",
          artist: "",
          description: "",
        }),
        { id: trackId },
      ),
    );
    assert.equal((await demoPage(args(listener, { share }))).track.artist, "");
    await db.update(links).set({ active: false }).where(eq(links.id, share));
    await assert.rejects(
      demoPage(args(listener, { share })),
      (e) => e instanceof Response && e.status === 404,
    );
  },
);

test(
  "legacy backfill only links unique names within the same account; ambiguous profiles require explicit selection",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      other = randomUUID();
    await db.insert(users).values([
      { id: owner, name: "Backfill owner", email: owner + "@test.invalid" },
      { id: other, name: "Other", email: other + "@test.invalid" },
    ]);
    const unique = randomUUID(),
      duplicate = randomUUID(),
      second = randomUUID(),
      foreign = randomUUID();
    await db.insert(artists).values([
      {
        id: unique,
        ownerId: owner,
        name: "\tSolo Artist  ",
        slug: `solo-${unique}`,
      },
      {
        id: duplicate,
        ownerId: owner,
        name: "Ambiguous",
        slug: `first-${duplicate}`,
      },
      {
        id: second,
        ownerId: owner,
        name: " ambiguous ",
        slug: `second-${second}`,
      },
      {
        id: foreign,
        ownerId: other,
        name: "Foreign Artist",
        slug: `foreign-${foreign}`,
      },
    ]);
    const ids = Array.from({ length: 5 }, () => randomUUID());
    await db.insert(tracks).values([
      {
        id: ids[0],
        ownerId: owner,
        title: "Unique",
        artist: "  SOLO ARTIST\n",
      },
      { id: ids[1], ownerId: owner, title: "Ambiguous", artist: "Ambiguous" },
      {
        id: ids[2],
        ownerId: owner,
        title: "Foreign",
        artist: "Foreign Artist",
      },
      { id: ids[3], ownerId: owner, title: "Empty", artist: "" },
      {
        id: ids[4],
        ownerId: owner,
        title: "Previously linked",
        artist: "Solo artist",
        artistId: duplicate,
      },
    ]);
    const migration = await readFile(
      new URL("../drizzle/0007_dizzy_sandman.sql", import.meta.url),
      "utf8",
    );
    await pool.query(migration.split("--> statement-breakpoint").at(-1)!);
    for (const [index, id] of ids.entries())
      assert.equal(
        (await db.query.tracks.findFirst({ where: eq(tracks.id, id) }))!
          .artistId,
        index === 0 ? unique : index === 4 ? duplicate : null,
      );
    assert.equal(
      (await resolveTrackArtist(owner, form({ artist: "AMBIGUOUS" }))).artistId,
      null,
    );
    assert.equal(
      (await resolveTrackArtist(owner, form({ artistId: second }))).artistId,
      second,
    );
  },
);

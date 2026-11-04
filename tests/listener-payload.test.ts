import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  sessions,
  artists,
  tracks,
  versions,
  links,
  releases,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { loader: demo } = await import("../app/routes/track");
const { loader: releasePage } = await import("../app/routes/release-page");
after(() => pool.end());
const args = (request: Request, params: Record<string, string>) => ({
  request,
  params,
  context: new RouterContextProvider(),
  url: new URL(request.url),
  pattern: "/",
});
const keys = (value: object) => Object.keys(value).sort();
const listenerTrack = [
  "artist",
  "cover",
  "coverRevision",
  "description",
  "id",
  "title",
];
const listenerVersion = [
  "canDownload",
  "description",
  "duration",
  "id",
  "metadata",
  "name",
  "peaks",
  "revision",
  "state",
  "status",
  "wavDownload",
];

test(
  "share pages send listeners only whitelisted track, version and release fields",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      session = randomUUID(),
      artist = randomUUID(),
      track = randomUUID(),
      share = randomUUID(),
      release = randomUUID();
    await db.insert(users).values({
      id: owner,
      name: "Payload owner",
      email: `${owner}@example.test`,
    });
    await db.insert(sessions).values({
      id: hash(session),
      userId: owner,
      expires: new Date(Date.now() + 3600000),
    });
    await db
      .insert(artists)
      .values({ id: artist, ownerId: owner, name: "Artist", slug: artist });
    await db.insert(tracks).values({
      id: track,
      ownerId: owner,
      artistId: artist,
      title: "Payload demo",
    });
    await db.insert(versions).values({
      trackId: track,
      name: "v1",
      filename: "Private_mix_DO_NOT_SEND.wav",
      state: "ready",
      original: "payload.wav",
      error: "Internal processing detail",
      download: true,
    });
    await db
      .insert(links)
      .values({ id: share, trackId: track, label: "Recipient" });
    const request = (path: string, cookie?: string) =>
      new Request(origin + path, {
        headers: cookie ? { cookie: `session=${cookie}` } : {},
      });

    for (const data of [
      await demo(args(request(`/s/${share}`), { share })),
      await demo(args(request(`/s/${share}?preview=1`, session), { share })),
    ]) {
      assert.equal(data.owner, false);
      assert.deepEqual(keys(data.track), listenerTrack);
      assert.equal(data.versions.length, 1);
      assert.deepEqual(keys(data.versions[0]), listenerVersion);
    }

    const owned = await demo(
      args(request(`/tracks/${track}`, session), { id: track }),
    );
    assert.equal(owned.owner, true);
    assert.equal(owned.track.artistId, artist);
    assert.equal(owned.versions[0].filename, "Private_mix_DO_NOT_SEND.wav");
    assert.equal(owned.versions[0].error, "Internal processing detail");
    assert.equal(typeof owned.versions[0].position, "number");

    await db.insert(releases).values({
      id: release,
      artistId: artist,
      title: "Single",
      slug: "single",
      published: true,
    });
    const page = await releasePage(
      args(request(`/artists/${artist}/single`), {
        artist,
        release: "single",
      }),
    );
    assert.deepEqual(keys(page.release), [
      "description",
      "id",
      "kind",
      "links",
      "metadata",
      "published",
      "slug",
      "title",
    ]);
  },
);

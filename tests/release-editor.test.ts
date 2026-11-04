import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  artists,
  releases,
  releaseTracks,
  sessions,
  users,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { action } from "../app/routes/release-edit";
import { enabled } from "./database";

after(() => pool.end());

test(
  "release editor saves details, adds tracks and reorders them",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      session = randomUUID(),
      artist = randomUUID(),
      release = randomUUID();
    await db
      .insert(users)
      .values({ id: owner, name: "Owner", email: `${owner}@example.test` });
    await db.insert(sessions).values({
      id: hash(session),
      userId: owner,
      expires: new Date(Date.now() + 60000),
    });
    await db
      .insert(artists)
      .values({ id: artist, ownerId: owner, name: "Artist", slug: artist });
    await db.insert(releases).values({
      id: release,
      artistId: artist,
      title: "Draft",
      slug: release,
    });
    const edit = (values: Record<string, string>) =>
      action({
        request: new Request(origin, {
          method: "POST",
          headers: { origin, cookie: `session=${session}` },
          body: new URLSearchParams(values),
        }),
        params: { id: release },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/",
      });
    const details = {
      intent: "metadata",
      title: "Pressure",
      kind: "ep",
      description: "About",
      genre: "Electronic",
      links: "Bandcamp | https://example.com/music",
      audioEnabled: "on",
    };

    assert.deepEqual(await edit({ ...details, releaseDate: "2026-02-30" }), {
      error: "Enter a valid release date.",
    });
    assert.deepEqual(
      await edit({ ...details, releaseDate: "2026-11-01", _inline: "1" }),
      { saved: true, error: undefined },
    );
    const saved = await db.query.releases.findFirst({
      where: eq(releases.id, release),
    });
    assert.equal(saved?.title, "Pressure");
    assert.equal(saved?.kind, "ep");
    assert.equal(saved?.audioEnabled, true);
    assert.equal(saved?.metadata.releaseDate, "2026-11-01");
    assert.equal(saved?.metadata.genre, "Electronic");
    assert.deepEqual(saved?.links, [
      { label: "Bandcamp", url: "https://example.com/music" },
    ]);

    for (const title of ["Opening", "Closing"]) {
      const added = await edit({ intent: "add-track", title });
      assert.ok(added instanceof Response);
      assert.equal(added.headers.get("Location"), `/releases/${release}`);
    }
    const tracks = () =>
      db
        .select()
        .from(releaseTracks)
        .where(eq(releaseTracks.releaseId, release))
        .orderBy(asc(releaseTracks.position));
    const [opening, closing] = await tracks();
    assert.deepEqual(
      [opening.title, opening.position, closing.title, closing.position],
      ["Opening", 1, "Closing", 2],
    );

    await edit({
      intent: "track",
      track: closing.id,
      position: "1",
      title: "Closing",
      isrc: "SEAAA2600001",
      explicit: "on",
    });
    const reordered = await tracks();
    assert.deepEqual(
      reordered.map((t) => [t.title, t.position]),
      [
        ["Closing", 1],
        ["Opening", 2],
      ],
    );
    assert.equal(reordered[0].metadata.isrc, "SEAAA2600001");
    assert.equal(reordered[0].metadata.explicit, true);

    assert.deepEqual(await edit({ intent: "rename", track: opening.id }), {
      error: "Unknown action",
    });
  },
);

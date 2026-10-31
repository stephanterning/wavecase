import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryRouter,
  MemoryRouter,
  RouterProvider,
  RouterContextProvider,
} from "react-router";
import { eq, inArray } from "drizzle-orm";
import { songwriters, songwriterPath } from "../app/domain/songwriters";
import { SongwriterCredits } from "../app/components/songwriter-credits";
import SongwriterPage, { loader } from "../app/routes/songwriter";
import ReleasePage from "../app/routes/release-page";
import PublicMusic from "../app/routes/public-music";
import { db, pool } from "../app/server/db";
import { artists, releases, releaseTracks, users } from "../app/server/schema";
import { origin } from "../app/server/security";

after(() => pool.end());

test("songwriter credits split complete names and normalize readable addresses", () => {
  assert.deepEqual(
    songwriters(
      "  Stéphan  Terning, Other Writer; STEPHAN TERNING\nÅsa Öberg\r\n",
    ),
    [
      { name: "Stéphan Terning", slug: "stephan-terning" },
      { name: "Other Writer", slug: "other-writer" },
      { name: "Åsa Öberg", slug: "asa-oberg" },
    ],
  );
  assert.deepEqual(songwriters(), []);
  assert.equal(songwriters("王菲")[0].slug, "王菲");
  assert.equal(songwriterPath("王菲"), "/songwriter/%E7%8E%8B%E8%8F%B2");
  assert.equal(
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(SongwriterCredits, {
          value: "Stephan Terning; Åsa Öberg",
        }),
      ),
    ).replaceAll(' data-discover="true"', ""),
    '<a href="/songwriter/stephan-terning">Stephan Terning</a>, <a href="/songwriter/asa-oberg">Åsa Öberg</a>',
  );
});

function renderPage(
  Component: typeof SongwriterPage | typeof ReleasePage,
  data: unknown,
) {
  const router = createMemoryRouter(
    [
      {
        Component: PublicMusic,
        children: [{ id: "page", path: "/", Component }],
      },
    ],
    {
      hydrationData: { loaderData: { page: data } },
    },
  );
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  } finally {
    router.dispose();
  }
}

test("release metadata links each songwriter to their generated page", () => {
  const html = renderPage(ReleasePage, {
    artist: { name: "Martin Dice", slug: "martin-dice" },
    release: {
      id: "release",
      title: "Pressure",
      kind: "single",
      metadata: {},
      links: [],
      published: true,
    },
    tracks: [
      {
        id: "track",
        title: "Pressure",
        position: 1,
        metadata: {
          songwriters: "Stephan Terning, Åsa Öberg",
          producers: "Example Producer",
        },
        available: false,
      },
    ],
  });
  assert.match(
    html,
    /href="\/songwriter\/stephan-terning"[^>]*>Stephan Terning<\/a>/,
  );
  assert.match(html, /href="\/songwriter\/asa-oberg"[^>]*>Åsa Öberg<\/a>/);
  assert.match(html, /<dd class="preserve-lines">Example Producer<\/dd>/);
});

test(
  "songwriter pages list each published release across artists once and reflect metadata/publication edits",
  {
    skip: !process.env.DATABASE_URL?.endsWith("/wavecase_test"),
  },
  async () => {
    const ownerIds = [randomUUID(), randomUUID()];
    const artistIds = [randomUUID(), randomUUID()];
    const releaseIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const trackIds = Array.from({ length: 5 }, () => randomUUID());
    const writerName = `Stephan Terning ${randomUUID()}`;
    const writerSlug = songwriters(writerName)[0].slug;
    const draftName = `Draft Writer ${randomUUID()}`;
    const load = (slug = writerSlug) =>
      loader({
        request: new Request(origin + songwriterPath(slug)),
        params: { songwriter: slug },
        context: new RouterContextProvider(),
        url: new URL(origin + songwriterPath(slug)),
        pattern: "/songwriter/:songwriter",
      });
    const missing = (error: unknown) =>
      error instanceof Response && error.status === 404;
    try {
      await db.insert(users).values(
        ownerIds.map((id) => ({
          id,
          name: "Owner",
          email: `${id}@example.test`,
        })),
      );
      await db.insert(artists).values(
        artistIds.map((id, i) => ({
          id,
          ownerId: ownerIds[i],
          name: ["Martin Dice", "HUST"][i],
          slug: `songwriter-test-${id}`,
        })),
      );
      await db.insert(releases).values([
        {
          id: releaseIds[0],
          artistId: artistIds[0],
          title: "Pressure",
          slug: "pressure",
          published: true,
          metadata: { releaseDate: "2025-01-01" },
          createdAt: new Date("2025-01-01"),
        },
        {
          id: releaseIds[1],
          artistId: artistIds[1],
          title: "Space Intro",
          slug: "space-intro",
          published: true,
          audioEnabled: false,
          metadata: { releaseDate: "2026-01-01" },
          createdAt: new Date("2026-01-01"),
        },
        {
          id: releaseIds[2],
          artistId: artistIds[0],
          title: "Private draft",
          slug: "draft",
          published: false,
        },
        {
          id: releaseIds[3],
          artistId: artistIds[0],
          title: "Different songwriter",
          slug: "different",
          published: true,
        },
      ]);
      await db.insert(releaseTracks).values([
        {
          id: trackIds[0],
          releaseId: releaseIds[0],
          title: "One",
          position: 1,
          metadata: { songwriters: `${writerName}, Co Writer` },
        },
        {
          id: trackIds[1],
          releaseId: releaseIds[0],
          title: "Two",
          position: 2,
          metadata: { songwriters: writerName },
        },
        {
          id: trackIds[2],
          releaseId: releaseIds[1],
          title: "Three",
          position: 1,
          metadata: {
            songwriters: `Other Writer; ${writerName.toUpperCase()}`,
          },
        },
        {
          id: trackIds[3],
          releaseId: releaseIds[2],
          title: "Secret",
          position: 1,
          metadata: { songwriters: `${writerName}, ${draftName}` },
        },
        {
          id: trackIds[4],
          releaseId: releaseIds[3],
          title: "Different",
          position: 1,
          metadata: {
            songwriters: `${writerName} Junior`,
            producers: writerName,
          },
        },
      ]);
      const data = await load();
      assert.equal(data.name, writerName);
      assert.equal(data.canonical, origin + songwriterPath(writerSlug));
      assert.deepEqual(
        data.releases.map((release) => release.id),
        [releaseIds[1], releaseIds[0]],
      );
      const html = renderPage(SongwriterPage, data);
      assert.match(html, /<h3>HUST - Space Intro<\/h3>/);
      assert.match(html, /<h3>Martin Dice - Pressure<\/h3>/);
      assert.ok(
        html.includes(`/artists/songwriter-test-${artistIds[1]}/space-intro`),
      );
      assert.doesNotMatch(html, /Private draft|Manage|Different songwriter/);
      await assert.rejects(load(songwriters(draftName)[0].slug), missing);
      await assert.rejects(load(`unknown-${randomUUID()}`), missing);

      await db
        .update(releaseTracks)
        .set({ metadata: { songwriters: "Someone Else" } })
        .where(eq(releaseTracks.id, trackIds[2]));
      assert.deepEqual(
        (await load()).releases.map((release) => release.id),
        [releaseIds[0]],
      );
      await db
        .update(releases)
        .set({ published: false })
        .where(eq(releases.id, releaseIds[0]));
      await assert.rejects(load(), missing);
      await db
        .update(releases)
        .set({ published: true })
        .where(eq(releases.id, releaseIds[0]));
      assert.equal((await load()).releases.length, 1);
    } finally {
      await db
        .delete(releaseTracks)
        .where(inArray(releaseTracks.releaseId, releaseIds));
      await db.delete(releases).where(inArray(releases.id, releaseIds));
      await db.delete(artists).where(inArray(artists.id, artistIds));
      await db.delete(users).where(inArray(users.id, ownerIds));
    }
  },
);

import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import ReleasePage from "../app/routes/release-page";
import PublicMusic from "../app/routes/public-music";
import type { TrackMetadata } from "../app/domain/releases";

function artistLine(name: string, slug: string, metadata: TrackMetadata[]) {
  const router = createMemoryRouter(
    [
      {
        Component: PublicMusic,
        children: [{ id: "release", path: "/", Component: ReleasePage }],
      },
    ],
    {
      hydrationData: {
        loaderData: {
          release: {
            artist: { name, slug },
            release: {
              id: "example",
              title: "Example",
              kind: "single",
              metadata: {},
              links: [],
              published: true,
            },
            tracks: metadata.map((fields, i) => ({
              id: String(i),
              position: i + 1,
              title: "Track",
              metadata: fields,
              available: false,
            })),
          },
        },
      },
    },
  );
  try {
    const html = renderToStaticMarkup(
      createElement(RouterProvider, { router }),
    );
    return html
      .replaceAll(' data-discover="true"', "")
      .match(/<div class="release-artist">(.*?)<\/div>/)?.[1];
  } finally {
    router.dispose();
  }
}

test("single-track release headings credit co-artists and guests without linking them", () => {
  assert.equal(
    artistLine("Martin Dice", "martin-dice", [
      { artist: "Martin Dice, Yuimbo" },
    ]),
    '<a href="/artists/martin-dice">Martin Dice</a>, Yuimbo',
  );
  assert.equal(
    artistLine("HUST", "hust", [{ artist: "HUST", guests: "Imad" }]),
    '<a href="/artists/hust">HUST</a> featuring Imad',
  );
});

test("headings retain the primary profile and do not promote individual album guests", () => {
  const primary = '<a href="/artists/hust">HUST</a>';
  assert.equal(artistLine("HUST", "hust", [{}]), primary);
  assert.equal(artistLine("HUST", "hust", []), primary);
  assert.equal(
    artistLine("Earth, Wind & Fire", "band", [
      { artist: "Earth, Wind & Fire" },
    ]),
    '<a href="/artists/band">Earth, Wind &amp; Fire</a>',
  );
  assert.equal(artistLine("HUST", "hust", [{ guests: "Imad" }, {}]), primary);
  assert.equal(
    artistLine("HUST", "hust", [{ artist: " hust , A & B, A & B, " }]),
    primary + ", A &amp; B",
  );
});

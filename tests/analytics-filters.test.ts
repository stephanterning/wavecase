import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import Analytics from "../app/routes/analytics";
import { pool } from "../app/server/db";

after(() => pool.end());
const data = {
  track: { id: "demo", title: "Demo" },
  links: [
    { id: "a", label: "Link A", active: true },
    { id: "b", label: "Link B", active: true },
  ],
  versions: [],
  events: [
    ["a", "one"],
    ["a", "one"],
    ["a", "two"],
    ["b", "three"],
  ].map(([linkId, browser], index) => ({
    label: `Link ${linkId.toUpperCase()}`,
    event: {
      id: String(index),
      linkId,
      browser,
      session: "test",
      kind: "play",
      createdAt: "2026-11-01T12:00:00Z",
      versionId: null,
      position: 0,
      end: null,
      context: null,
    },
  })),
};
function render(search: string, loaderData: unknown = data) {
  const router = createMemoryRouter(
    [{ id: "analytics", path: "/", Component: Analytics }],
    {
      initialEntries: [`/${search}`],
      hydrationData: { loaderData: { analytics: loaderData } },
    },
  );
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  } finally {
    router.dispose();
  }
}

test("analytics restores both filters from the URL", () => {
  const html = render("?link=a&browser=one");
  assert.match(html, /value="a" selected=""/);
  assert.match(html, /value="one" selected=""/);
  assert.match(html, /0 visits · 2 plays · 1 browsers/);
  assert.doesNotMatch(html, /Browser ID: three/);
});

test("analytics ignores a browser outside the selected link and stale link IDs", () => {
  assert.match(
    render("?link=a&browser=three"),
    /0 visits · 3 plays · 2 browsers/,
  );
  assert.match(
    render("?link=deleted&browser=gone"),
    /0 visits · 4 plays · 3 browsers/,
  );
});

test("version changes appear as position markers without adding plays or skipped coverage", () => {
  const html = render("", {
    ...data,
    versions: [{ id: "v2", name: "Version 2", duration: 120 }],
    events: [
      {
        ...data.events[0],
        event: {
          ...data.events[0].event,
          kind: "version-changed",
          versionId: "v2",
          position: 94,
        },
      },
    ],
  });
  assert.match(html, /Version 2 · Changed version at 1:34/);
  assert.match(html, /class="marker"/);
  assert.match(html, /0 visits · 0 plays/);
  assert.doesNotMatch(html, /Skipped forward|class="skipped"/);
});

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createMemoryRouter, RouterProvider } from "react-router";
import { ShareLinks } from "../app/components/share-links";
import Account from "../app/routes/account";
import { pool } from "../app/server/db";

after(() => pool.end());

function render(Component: ComponentType, loaderData: unknown = null) {
  const router = createMemoryRouter([{ id: "page", path: "/", Component }], {
    hydrationData: { loaderData: { page: loaderData } },
  });
  try {
    return renderToStaticMarkup(createElement(RouterProvider, { router }));
  } finally {
    router.dispose();
  }
}

const link = {
  download: true,
  fromOrder: null,
  pinnedOrder: null,
  plays: 0,
  downloads: 0,
};

test("share link icon controls name their link and show it as a focusable tooltip", () => {
  const html = render(() =>
    createElement(ShareLinks, {
      trackId: "track",
      versions: [],
      links: [
        { ...link, id: "a", label: "Mixing team", active: true },
        { ...link, id: "b", label: "Label", active: false },
      ],
    }),
  );
  for (const name of [
    "Copy link: Mixing team",
    "Edit link: Mixing team",
    "Delete link: Mixing team",
  ])
    assert.ok(
      html.includes(`aria-label="${name}" data-tooltip="${name}"`),
      name,
    );
  assert.ok(
    html.includes(
      'aria-label="Preview as listener: Mixing team (opens in a new tab)"',
    ),
  );
  assert.ok(
    html.includes(
      'aria-label="Preview unavailable: Label is disabled" data-tooltip="Enable this link to preview it"',
    ),
  );
  assert.doesNotMatch(html, /<(button|a)\b[^>]* title=/);
});

test("passkey removal buttons name the passkey they remove", () => {
  const html = render(Account, {
    user: { name: "Owner", email: "owner@example.com" },
    keys: ["first-key", "second-key"].map((id) => ({
      id,
      createdAt: null,
      lastUsedAt: null,
    })),
  });
  assert.match(html, /aria-label="Remove passkey 1"[^>]*>Remove</);
  assert.match(html, /aria-label="Remove passkey 2"[^>]*>Remove</);
});

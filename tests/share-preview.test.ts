import assert from "node:assert/strict";
import { after, test } from "node:test";
import { pool } from "../app/server/db";

// Route imports initialize the queue configuration; these tests do not connect.
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { meta } = await import("../app/routes/share");

after(() => pool.end());

function preview(cover: boolean, artist = "Test artist", error?: Error) {
  return meta({
    loaderData: {
      track: {
        id: "track-id",
        title: "Night & Day",
        artist,
        description: "",
        cover,
      },
      share: "private-token",
      shareUrl: "https://music.example/s/private-token",
    },
    error,
  } as unknown as Parameters<typeof meta>[0])!;
}

test("share previews include the track and artist with an authorized absolute cover URL", () => {
  const tags = preview(true);
  assert.ok(
    tags.some(
      (tag) =>
        "property" in tag &&
        tag.property === "og:title" &&
        tag.content === "Night & Day — Test artist",
    ),
  );
  assert.ok(
    tags.some(
      (tag) =>
        "property" in tag &&
        tag.property === "og:image" &&
        tag.content ===
          "https://music.example/cover/track-id?share=private-token",
    ),
  );
});

test("tracks without artwork or artist still have a meaningful preview", () => {
  const tags = preview(false, "");
  assert.ok(
    tags.some(
      (tag) =>
        "property" in tag &&
        tag.property === "og:title" &&
        tag.content === "Night & Day",
    ),
  );
  assert.ok(
    !tags.some((tag) => "property" in tag && tag.property === "og:image"),
  );
});

test("failed share loads never retain track metadata", () => {
  assert.deepEqual(preview(true, "Test artist", new Error("Unavailable")), [
    { title: "Wavecase" },
    { name: "robots", content: "noindex" },
  ]);
});

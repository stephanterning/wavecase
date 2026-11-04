import { test } from "node:test";
import assert from "node:assert/strict";
import { compareLibraryTracks, type LibrarySort } from "../app/domain/library";

const row = (
  id: string,
  updatedAt: string | null,
  createdAt = "2026-10-01T12:00:00Z",
) => ({
  id,
  updatedAt,
  createdAt,
  title: id,
  artist: "",
  versionCount: 1,
  favorite: false,
});

test("library defaults to full upload timestamps, creation timestamps, then stable identity", () => {
  const rows = [
    row("empty-old", null),
    row("older-upload", "2026-11-04T09:00:00Z", "2026-11-04T11:00:00Z"),
    row("tie-old", "2026-11-04T10:00:00Z"),
    row("empty-new", null, "2026-11-04T12:00:00Z"),
    row("tie-new", "2026-11-04T10:00:00Z", "2026-11-02T12:00:00Z"),
    row("latest", "2026-11-04T11:00:00Z"),
  ];
  assert.deepEqual(
    rows.sort(compareLibraryTracks).map((r) => r.id),
    ["latest", "tie-new", "tie-old", "older-upload", "empty-new", "empty-old"],
  );
  assert.equal(compareLibraryTracks(row("a", null), row("b", null)), -1);
  assert.deepEqual(
    rows
      .sort((a, b) => compareLibraryTracks(a, b, "updatedAt", true))
      .map((r) => r.id),
    ["older-upload", "tie-new", "tie-old", "latest", "empty-new", "empty-old"],
  );
});

test("each library column sorts in both directions with numeric versions and favorites first", () => {
  const a = {
    ...row("a", "2026-11-03T10:00:00Z"),
    title: "Demo 2",
    artist: "Alpha",
    versionCount: 2,
  };
  const b = {
    ...row("b", "2026-11-04T10:00:00Z", "2026-11-02T12:00:00Z"),
    title: "Demo 10",
    artist: "beta",
    versionCount: 10,
    favorite: true,
  };
  for (const sort of [
    "favorite",
    "title",
    "artist",
    "versionCount",
    "updatedAt",
    "createdAt",
  ] satisfies LibrarySort[]) {
    assert.ok(compareLibraryTracks(a, b, sort, true) < 0, sort);
    assert.ok(compareLibraryTracks(a, b, sort, false) > 0, sort);
  }
});

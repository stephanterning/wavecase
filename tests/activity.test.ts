import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityTimeline,
  summarizeActivity,
  uniqueCoverage,
  type Activity,
} from "../app/domain/activity";
test("analytics distinguish replays, unique coverage, visits and downloads without merging across seeks", () => {
  const rows: Activity[] = [
    { kind: "visit", position: 0, end: null, versionId: null },
    { kind: "play", position: 0, end: null, versionId: "v1" },
    { kind: "interval", position: 0, end: 10, versionId: "v1" },
    { kind: "interval", position: 10, end: 20, versionId: "v1" },
    { kind: "seek", position: 20, end: 0, versionId: "v1" },
    { kind: "interval", position: 0, end: 10, versionId: "v1" },
    { kind: "download-started", position: null, end: null, versionId: "v1" },
  ].map((e, i) => ({
    ...e,
    id: String(i),
    browser: "browser",
    name: null,
    createdAt: new Date(i * 1000),
  }));
  const result = summarizeActivity(rows);
  assert.equal(result.listening, 30);
  assert.equal(uniqueCoverage(rows), 20);
  assert.equal(result.visits, 1);
  assert.equal(result.plays, 1);
  assert.equal(result.downloads, 1);
  const timeline = activityTimeline(rows.toReversed());
  assert.equal(timeline.length, 6);
  assert.equal(timeline[2].end, 20);
  assert.equal(timeline[3].kind, "seek");
  assert.equal(timeline[4].position, 0);
  assert.equal(rows[2].end, 10);
});

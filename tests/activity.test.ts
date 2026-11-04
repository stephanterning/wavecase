import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityReport,
  activityTimeline,
  summarizeActivity,
  timelineBar,
  uniqueCoverage,
  type Activity,
} from "../app/domain/activity";
const row = (
  id: string,
  linkId: string,
  browser: string,
  session: string,
  event: Partial<Activity> = {},
) => ({
  label: "Link " + linkId,
  event: {
    id,
    linkId,
    browser,
    session,
    kind: "play",
    name: null,
    versionId: "v1",
    position: 0,
    end: null,
    createdAt: new Date(0),
    ...event,
  },
});
const ids = (rows: { event: { id: string } }[]) => rows.map((r) => r.event.id);

test("activity report applies link and browser filters only when they match the data", () => {
  const rows = [
    row("1", "a", "x", "s1", { kind: "download-started" }),
    row("2", "a", "y", "s2", { name: "Robin", versionId: "v2" }),
    row("3", "b", "z", "s3"),
    row("4", "a", "x", "s1", { name: "Alex" }),
  ];
  const all = activityReport(rows, ["a", "b"], { link: "", browser: "" });
  assert.deepEqual(ids(all.rows), ["1", "2", "3", "4"]);
  assert.deepEqual(
    all.listeners.map((l) => [l.id, l.name, ids(l.rows)]),
    [
      ["x", "Alex", ["1", "4"]],
      ["y", "Robin", ["2"]],
      ["z", null, ["3"]],
    ],
  );
  assert.deepEqual(ids(all.byLink.get("a")!), ["1", "2", "4"]);
  assert.deepEqual(ids(all.byVersion.get("v2")!), ["2"]);
  assert.deepEqual(ids(all.downloads), ["1"]);

  const unknown = activityReport(rows, ["a", "b"], {
    link: "deleted",
    browser: "nobody",
  });
  assert.equal(unknown.link, "");
  assert.equal(unknown.browser, "");
  assert.equal(unknown.rows.length, 4);

  const outsideLink = activityReport(rows, ["a", "b"], {
    link: "a",
    browser: "z",
  });
  assert.equal(outsideLink.browser, "");
  assert.deepEqual(ids(outsideLink.rows), ["1", "2", "4"]);
  assert.deepEqual(
    outsideLink.listeners.map((l) => l.id),
    ["x", "y"],
  );

  const one = activityReport(rows, ["a", "b"], { link: "a", browser: "x" });
  assert.deepEqual(ids(one.rows), ["1", "4"]);
  assert.deepEqual(ids(one.downloads), ["1"]);
});

test("activity sessions are split by link, browser and session id", () => {
  const rows = [
    row("1", "a", "x", "s1", {
      kind: "interval",
      position: 5,
      end: 10,
      createdAt: new Date(2000),
    }),
    row("2", "b", "x", "s1"),
    row("3", "a", "y", "s1"),
    row("4", "a", "x", "s1", {
      kind: "interval",
      position: 0,
      end: 5,
      createdAt: new Date(1000),
    }),
    row("5", "a", "x", "s2"),
  ];
  const { sessions } = activityReport(rows, ["a", "b"], {
    link: "",
    browser: "",
  });
  assert.deepEqual(
    sessions.map((s) => [s.browser, ids(s.rows)]),
    [
      ["x", ["1", "4"]],
      ["x", ["2"]],
      ["y", ["3"]],
      ["x", ["5"]],
    ],
  );
  assert.equal(sessions[0].rows[0].label, "Link a");
  assert.deepEqual(
    sessions[0].timeline.map((e) => [e.position, e.end]),
    [[0, 10]],
  );
});

test("timeline bars stay inside the version and remain visible", () => {
  const event = (kind: string, position: number | null, end: number | null) =>
    row("1", "a", "x", "s", { kind, position, end }).event;
  assert.deepEqual(timelineBar(event("interval", 25, 50), 100), {
    left: 25,
    width: 25,
    kind: "played",
  });
  assert.deepEqual(timelineBar(event("seek", 80, 20), 100), {
    left: 20,
    width: 60,
    kind: "backward",
  });
  assert.equal(timelineBar(event("seek", 20, 80), 100).kind, "skipped");
  assert.deepEqual(timelineBar(event("pause", 40, null), 100), {
    left: 40,
    width: 0.5,
    kind: "marker",
  });
  assert.deepEqual(timelineBar(event("interval", 90, 130), 100), {
    left: 90,
    width: 10,
    kind: "played",
  });
});
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

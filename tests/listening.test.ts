import { test } from "node:test";
import assert from "node:assert/strict";
import { coverage, heatmap } from "../app/domain/listening";
test("replayed passages count twice in heatmaps but once in unique coverage", () => {
  const intervals = [
    { start: 0, end: 60 },
    { start: 0, end: 60 },
    { start: 90, end: 120 },
  ];
  assert.equal(coverage(intervals), 90);
  assert.deepEqual(heatmap(intervals, 120, 4), [2, 2, 0, 1]);
});

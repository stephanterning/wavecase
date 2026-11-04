import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatClock,
  formatCount,
  formatDate,
  formatDateTime,
} from "../app/domain/format";

test("dates use one readable UTC format regardless of the input type", () => {
  const value = "2026-09-04T23:05:09.500Z";
  assert.equal(formatDate(value), "4 Sep 2026");
  assert.equal(formatDate(new Date(value)), "4 Sep 2026");
  assert.equal(formatDateTime(value), "4 Sep 2026, 23:05 UTC");
  assert.equal(
    formatDateTime(Date.parse(value), { seconds: true }),
    "4 Sep 2026, 23:05:09 UTC",
  );
  assert.equal(formatDateTime("2027-01-01T00:00:00Z"), "1 Jan 2027, 00:00 UTC");
});

test("clock times round down to whole seconds", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(4.99), "0:04");
  assert.equal(formatClock(65), "1:05");
  assert.equal(formatClock(3725), "62:05");
});

test("counts use singular and plural forms", () => {
  assert.equal(formatCount(0, "play"), "0 plays");
  assert.equal(formatCount(1, "play"), "1 play");
  assert.equal(formatCount(2, "published release"), "2 published releases");
  assert.equal(formatCount(1, "browser"), "1 browser");
  assert.equal(formatCount(3, "copy", "copies"), "3 copies");
});

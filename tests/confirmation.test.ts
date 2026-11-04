import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesConfirmation } from "../app/domain/confirmation";

test("typed confirmations accept dash, quote and space variants but not other titles", () => {
  assert.ok(
    matchesConfirmation("Audit test - Delete me", "Audit test – Delete me"),
  );
  assert.ok(matchesConfirmation(" Night  Drive—Demo ", "Night Drive-Demo"));
  assert.ok(matchesConfirmation("Don’t stop", "Don't stop"));
  assert.ok(matchesConfirmation("ｖ２", "v2"));
  assert.ok(
    !matchesConfirmation("Audit test - Keep me", "Audit test – Delete me"),
  );
  assert.ok(!matchesConfirmation("V2", "v2"));
  assert.ok(!matchesConfirmation("", "v2"));
});

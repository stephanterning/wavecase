import { test } from "node:test";
import assert from "node:assert/strict";

test("repeat lasts across browser sessions and survives unavailable storage", async (t) => {
  const stored = new Map([["wavecase.repeat", "on"]]);
  let available = true;
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (!available) throw new DOMException("Blocked", "SecurityError");
      stored.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  t.after(() => Reflect.deleteProperty(globalThis, "localStorage"));
  const { repeatPreference, setRepeatPreference } =
    await import("../app/components/repeat-preference");
  assert.equal(
    repeatPreference(),
    true,
    "a new session restores the browser's choice",
  );
  setRepeatPreference(false);
  assert.equal(stored.get("wavecase.repeat"), "off");
  assert.equal(repeatPreference(), false);
  available = false;
  assert.doesNotThrow(() => setRepeatPreference(true));
  assert.equal(repeatPreference(), true, "the page keeps the choice in memory");
});

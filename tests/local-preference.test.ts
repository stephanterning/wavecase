import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  createLocalPreference,
  useLocalPreference,
} from "../app/components/local-preference";
import { librarySortPreference } from "../app/components/library-sort-preference";
import { librarySorts } from "../app/domain/library";

function browser(t: TestContext) {
  const previous = new Map(
    ["window", "localStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
  };
  const window = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: window,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return { stored, storage, window };
}

test("each library column and direction persists together with stable snapshots", (t) => {
  const { stored } = browser(t);
  for (const sort of librarySorts)
    for (const ascending of [true, false]) {
      librarySortPreference.set({ sort, ascending });
      assert.deepEqual(JSON.parse(stored.get("wavecase.library.sort")!), {
        sort,
        ascending,
      });
      const snapshot = librarySortPreference.getSnapshot();
      assert.deepEqual(snapshot, { sort, ascending });
      assert.equal(librarySortPreference.getSnapshot(), snapshot);
      const reloaded = createLocalPreference(
        "wavecase.library.sort",
        {},
        JSON.parse,
      );
      assert.deepEqual(reloaded.getSnapshot(), { sort, ascending });
    }
});

test("invalid saved sorting falls back safely and SSR uses the default", (t) => {
  const { stored } = browser(t);
  const defaultSorting = { sort: "updatedAt", ascending: false };
  for (const invalid of [
    "broken",
    "null",
    "[]",
    '"title"',
    '{"sort":"unknown","ascending":true}',
    '{"sort":"title","ascending":"false"}',
  ]) {
    stored.set("wavecase.library.sort", invalid);
    assert.deepEqual(librarySortPreference.getSnapshot(), defaultSorting);
  }
  stored.set("wavecase.library.sort", '{"sort":"title","ascending":true}');
  assert.deepEqual(librarySortPreference.getSnapshot(), {
    sort: "title",
    ascending: true,
  });
  function Choice() {
    const { sort } = useLocalPreference(librarySortPreference);
    return createElement("span", null, sort);
  }
  assert.equal(renderToString(createElement(Choice)), "<span>updatedAt</span>");
  Reflect.deleteProperty(globalThis, "localStorage");
  Reflect.deleteProperty(globalThis, "window");
  assert.equal(renderToString(createElement(Choice)), "<span>updatedAt</span>");
});

test("local changes, other tabs and cleared storage notify subscribers", (t) => {
  const { stored, window } = browser(t);
  const preference = createLocalPreference("repeat", false, JSON.parse);
  const changes: boolean[] = [];
  const stop = preference.subscribe(() =>
    changes.push(preference.getSnapshot()),
  );
  preference.set(true);
  assert.deepEqual(changes, [true]);
  stored.set("repeat", "false");
  window.dispatchEvent(Object.assign(new Event("storage"), { key: "other" }));
  assert.deepEqual(changes, [true]);
  window.dispatchEvent(Object.assign(new Event("storage"), { key: "repeat" }));
  assert.deepEqual(changes, [true, false]);
  stored.clear();
  window.dispatchEvent(Object.assign(new Event("storage"), { key: null }));
  assert.deepEqual(changes, [true, false, false]);
  stop();
  preference.set(true);
  assert.equal(changes.length, 3);
});

test("full or blocked storage leaves controls usable on the current page", (t) => {
  const { storage, stored } = browser(t);
  const preference = createLocalPreference("repeat", false, JSON.parse);
  stored.set("repeat", "false");
  assert.equal(preference.getSnapshot(), false);
  storage.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  preference.set(true);
  assert.equal(preference.getSnapshot(), true);
  assert.equal(stored.get("repeat"), "false");
  storage.getItem = () => {
    throw new Error("SecurityError");
  };
  const blocked = createLocalPreference("blocked", false, JSON.parse);
  assert.equal(blocked.getSnapshot(), false);
  blocked.set(true);
  assert.equal(blocked.getSnapshot(), true);
  preference.set(false);
  assert.equal(preference.getSnapshot(), false);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CompressedAudioCache,
  compressedAudioCache,
  attachAudioCacheSession,
  compressedCacheBytes,
} from "../app/components/compressed-audio-cache";

test("one byte budget covers FLAC and MP3 and evicts the least recently used parts", () => {
  assert.equal(compressedCacheBytes, 96_000_000);
  const cache = new CompressedAudioCache(10);
  const put = (key: string, bytes: number) =>
    cache.put(key, key, new ArrayBuffer(bytes), cache.generation);
  put("flac-a", 4);
  put("mp3", 4);
  assert.equal(cache.get("flac-a")!.byteLength, 4);
  put("flac-b", 4);
  assert.equal(cache.byteLength, 8);
  assert.equal(cache.get("mp3"), undefined);
  assert.ok(cache.get("flac-a"));
  put("flac-b", 6);
  assert.equal(cache.byteLength, 10);
  put("oversized", 11);
  assert.equal(cache.byteLength, 10);
  assert.equal(cache.get("oversized"), undefined);
});

test("clearing or revoking a source prevents in-flight work from repopulating it", () => {
  const cache = new CompressedAudioCache(10);
  const before = cache.generation;
  cache.put("one", "private", new ArrayBuffer(4), before);
  cache.put("two", "public", new ArrayBuffer(4), before);
  cache.forget("private");
  cache.put("late", "private", new ArrayBuffer(4), before);
  assert.equal(cache.get("one"), undefined);
  assert.equal(cache.get("late"), undefined);
  assert.ok(cache.get("two"));
  const old = cache.generation;
  cache.clear();
  cache.put("late-again", "public", new ArrayBuffer(4), old);
  assert.equal(cache.byteLength, 0);
});

test("session exit, page exit and learned revocation clear the shared cache", (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const target = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: target,
  });
  t.after(() => {
    compressedAudioCache.clear();
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const exit = attachAudioCacheSession();
  const put = () =>
    compressedAudioCache.put(
      "key",
      "source",
      new ArrayBuffer(4),
      compressedAudioCache.generation,
    );
  put();
  target.dispatchEvent(new Event("pagehide"));
  assert.equal(compressedAudioCache.byteLength, 0);
  put();
  target.dispatchEvent(new Event("wavecase-access-revoked"));
  assert.equal(compressedAudioCache.byteLength, 0);
  put();
  exit();
  assert.equal(compressedAudioCache.byteLength, 0);
});

test("highly compressed silence also has a bounded entry count", () => {
  const cache = new CompressedAudioCache();
  for (let i = 0; i < 4097; i++)
    cache.put(String(i), "source", new ArrayBuffer(1), cache.generation);
  assert.equal(cache.get("0"), undefined);
  assert.equal(cache.byteLength, 4096);
});

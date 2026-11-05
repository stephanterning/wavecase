import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPlaybackMedia,
  startPlaybackAt,
  seekPlayback,
} from "../app/components/playback-audio";
import { BufferedAudio } from "../app/components/buffered-audio";

test("Apple browsers use native files even when the worklet is available; other browsers retain buffered playback", (t) => {
  const saved = ["Audio", "AudioContext", "navigator"].map(
    (name) =>
      [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const,
  );
  t.after(() => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  let contexts = 0;
  class Media extends EventTarget {}
  class Context {
    sampleRate = 48000;
    audioWorklet = {};
    destination = {};
    constructor() {
      contexts++;
    }
    createGain() {
      return { connect() {} };
    }
  }
  const client = {
    vendor: "Apple Computer, Inc.",
    userAgent: "iPhone",
    maxTouchPoints: 5,
  };
  for (const [name, value] of Object.entries({
    Audio: Media,
    AudioContext: Context,
    navigator: client,
  }))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  assert.ok(createPlaybackMedia(60) instanceof Media);
  client.userAgent = "Macintosh";
  client.maxTouchPoints = 0;
  assert.ok(createPlaybackMedia(60) instanceof Media);
  assert.equal(
    contexts,
    0,
    "selection does not create a competing audio context on Apple browsers",
  );
  client.vendor = "Google Inc.";
  assert.ok(createPlaybackMedia(60) instanceof BufferedAudio);
  assert.equal(contexts, 1);
  assert.ok(
    createPlaybackMedia(0) instanceof Media,
    "unknown durations keep the native fallback",
  );
});

test("a paused native version restores position after metadata unless the listener seeks first", () => {
  const media = Object.assign(new EventTarget(), {
    readyState: 0,
    currentTime: 0,
    duration: 60,
  });
  const audio = media as unknown as HTMLAudioElement;
  startPlaybackAt(audio, 12);
  assert.equal(media.currentTime, 0);
  media.readyState = 1;
  media.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(media.currentTime, 12);
  media.readyState = 0;
  startPlaybackAt(audio, 20);
  seekPlayback(audio, 30);
  media.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(media.currentTime, 30);
});

import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import Hls from "hls.js";
import { playbackGainDb } from "../app/domain/playback-gain";
import {
  createPlaybackMedia,
  setPlaybackSource,
  playMedia,
  switchPlayback,
  destroyPlaybackMedia,
  seekPlayback,
  startPlaybackAt,
} from "../app/components/playback-audio";

test("playback targets -16 LUFS with sample and true peak ceilings", () => {
  assert.equal(playbackGainDb({ lufs: -10, peak: -1, truePeak: -0.5 }), -6);
  assert.equal(playbackGainDb({ lufs: -24, peak: -12, truePeak: -10 }), 8);
  assert.equal(playbackGainDb({ lufs: -16, peak: -3, truePeak: -2 }), 0);
  assert.equal(playbackGainDb({ lufs: -24, peak: -3, truePeak: -4 }), 3);
  assert.equal(playbackGainDb({ lufs: -24, peak: -4, truePeak: -2 }), 1.99);
  assert.equal(playbackGainDb({ lufs: -24, peak: -1, truePeak: 1 }), -1.01);
  for (const metadata of [
    { lufs: -10, peak: -1, truePeak: -0.5 },
    { lufs: -24, peak: -3, truePeak: -4 },
    { lufs: -24, peak: -4, truePeak: -2 },
    { lufs: -24, peak: -1, truePeak: 1 },
  ]) {
    const gain = playbackGainDb(metadata);
    assert.ok(metadata.lufs + gain <= -16);
    assert.ok(metadata.peak + gain <= 0);
    assert.ok(metadata.truePeak + gain < 0);
  }
});

test("silence and missing or non-finite measurements never cause unsafe gain", () => {
  for (const metadata of [
    null,
    {},
    { lufs: null, peak: null, truePeak: null },
    { lufs: -Infinity, peak: -Infinity, truePeak: -Infinity },
    { lufs: NaN, peak: -8, truePeak: -6 },
    { lufs: -30, peak: null, truePeak: -6 },
    { lufs: -30, peak: -8, truePeak: undefined },
    { lufs: "-30", peak: -8, truePeak: -6 },
  ])
    assert.equal(playbackGainDb(metadata), 0);
  assert.equal(playbackGainDb({ lufs: -10 }), -6);
  assert.equal(playbackGainDb({ lufs: null, peak: -1, truePeak: 2 }), -2.01);
});

class Audio extends EventTarget {
  src = "";
  muted = false;
  paused = true;
  error = null;
  readyState = 0;
  currentTime = 0;
  constructor(private native = "maybe") {
    super();
  }
  canPlayType() {
    return this.native;
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}
const element = (value: Audio) => value as unknown as HTMLAudioElement;

function browser(t: TestContext, vendor: string, mse = false) {
  const names = ["Audio", "window", "navigator", "MediaSource"] as const;
  const saved = names.map((name) =>
    Object.getOwnPropertyDescriptor(globalThis, name),
  );
  const values = {
    Audio,
    window: { location: { href: "https://music.test/tracks/1" } },
    navigator: { vendor },
    MediaSource: mse ? { isTypeSupported: () => false } : undefined,
  };
  for (const name of names)
    Object.defineProperty(globalThis, name, {
      configurable: true,
      value: values[name],
    });
  t.mock.method(Hls, "isSupported", () => mse);
  t.after(() =>
    names.forEach((name, index) => {
      const value = saved[index];
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }),
  );
}

test("Safari plays native FLAC HLS and version switches cut to the prepared element", async (t) => {
  browser(t, "Apple Computer, Inc.", true);
  const first = createPlaybackMedia() as unknown as Audio;
  const next = createPlaybackMedia() as unknown as Audio;
  setPlaybackSource(element(first), "/media/version?share=secret");
  assert.equal(
    first.src,
    "https://music.test/media/version?share=secret&hls=flac",
  );
  await playMedia(element(first));
  assert.equal(first.paused, false);
  assert.equal(first.muted, false);
  await playMedia(element(next), true);
  assert.equal(next.muted, true);
  switchPlayback(element(first), element(next));
  assert.equal(first.paused, true);
  assert.equal(next.muted, false);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(next, "play", () => new Promise<void>(() => {}));
  const pending = playMedia(element(next));
  const rejected = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(next.paused, true);
  destroyPlaybackMedia(element(first));
  assert.equal(first.src, "");
});

test("other browsers use hls.js when MSE exists, even if they claim native HLS", (t) => {
  browser(t, "Google Inc.", true);
  const loaded: string[] = [];
  t.mock.method(Hls.prototype, "attachMedia", () => {});
  t.mock.method(Hls.prototype, "loadSource", (url: string) => {
    loaded.push(url);
  });
  const media = new Audio("maybe");
  setPlaybackSource(element(media), "/release-assets/r/audio?track=t");
  assert.equal(media.src, "", "the native player is not used");
  assert.deepEqual(loaded, [
    "https://music.test/release-assets/r/audio?track=t&hls=aac",
  ]);
  destroyPlaybackMedia(element(media));
});

test("browsers without MSE fall back to native HLS", (t) => {
  browser(t, "Google Inc.");
  const media = new Audio("maybe");
  setPlaybackSource(element(media), "/media/version");
  assert.equal(media.src, "https://music.test/media/version?hls=flac");
});

test("a paused start position waits for metadata unless the listener seeks first", () => {
  const media = new Audio();
  startPlaybackAt(element(media), 12);
  assert.equal(media.currentTime, 0);
  media.readyState = 1;
  media.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(media.currentTime, 12);
  const seeked = new Audio();
  startPlaybackAt(element(seeked), 12);
  seeked.dispatchEvent(new Event("wavecase-user-seek"));
  seeked.currentTime = 30;
  seeked.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(seeked.currentTime, 30);
  const loaded = new Audio();
  loaded.readyState = 1;
  startPlaybackAt(element(loaded), 7);
  assert.equal(loaded.currentTime, 7);
});

test("rapid seeks keep only the latest position and do not count as native loops", () => {
  const fake = Object.assign(new EventTarget(), {
    currentTime: 1,
    duration: 60,
    seeking: true,
    paused: false,
  });
  const media = fake as unknown as HTMLAudioElement;
  let completed = 0;
  media.addEventListener("wavecase-user-seeked", () => completed++);
  seekPlayback(media, 20);
  seekPlayback(media, 40);
  assert.equal(media.currentTime, 40);
  fake.seeking = false;
  media.dispatchEvent(new Event("seeked"));
  assert.equal(completed, 1);
});

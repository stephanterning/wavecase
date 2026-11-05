import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPlaybackMedia,
  setPlaybackSource,
  playNormalized,
  crossfadePlayback,
  disconnectPlaybackAudio,
} from "../app/components/playback-audio";

class Audio extends EventTarget {
  src = "";
  muted = false;
  paused = true;
  error = null;
  calls = 0;
  canPlayType() {
    return "probably";
  }
  play() {
    this.calls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

test("native HLS plays pre-normalized FLAC directly without creating an AudioContext", async (t) => {
  const audio = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  const window = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: Audio,
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: "https://music.test/tracks/1" } },
  });
  t.after(() => {
    for (const [name, value] of [
      ["Audio", audio],
      ["window", window],
    ] as const) {
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  const first = createPlaybackMedia(60) as unknown as Audio;
  const next = createPlaybackMedia(60) as unknown as Audio;
  const media = (value: Audio) => value as unknown as HTMLAudioElement;
  setPlaybackSource(media(first), "/media/version?share=secret");
  assert.equal(
    first.src,
    "https://music.test/media/version?share=secret&hls=flac",
  );
  await playNormalized(media(first), 20);
  assert.equal(first.paused, false);
  assert.equal(first.muted, false);
  await playNormalized(media(next), -20, true);
  assert.equal(next.muted, true);
  crossfadePlayback(media(first), media(next));
  assert.equal(first.paused, true);
  assert.equal(next.muted, false);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(next, "play", () => new Promise<void>(() => {}));
  const pending = playNormalized(media(next), 0);
  const rejected = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(30000);
  await rejected;
  assert.equal(next.paused, true);
  disconnectPlaybackAudio(media(first));
  disconnectPlaybackAudio(media(next));
});

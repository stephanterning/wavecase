import type { PlaybackMedia } from "../app/components/playback-audio";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoPlayback, type DemoSource } from "../app/components/demo-playback";

class Media extends EventTarget {
  src = "";
  preload = "";
  loop = false;
  paused = true;
  currentTime = 0;
  duration = 60;
  readyState = 0;
  seeking = false;
  error: Error | null = null;
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("playing"));
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
  ready(state = 3) {
    this.readyState = state;
    this.dispatchEvent(new Event("loadedmetadata"));
    this.dispatchEvent(new Event("canplay"));
  }
}
const source = (id: string): DemoSource => ({
  key: id,
  versionId: id,
  url: `/media/${id}`,
  duration: 60,
  gainDb: -3,
  peaks: [0, 1, 0],
  title: "Demo",
  artist: "Artist",
});
function setup() {
  const media: Media[] = [];
  const plays: { media: PlaybackMedia; silent: boolean }[] = [];
  const fades: [PlaybackMedia | null, PlaybackMedia][] = [];
  const playback = new DemoPlayback(
    () => {
      const next = new Media();
      media.push(next);
      return next as unknown as PlaybackMedia;
    },
    async (audio, _gain, silent = false) => {
      plays.push({ media: audio, silent });
      await audio.play();
    },
    (previous, next) => {
      fades.push([previous, next]);
    },
  );
  return { playback, media, plays, fades, state: playback.getSnapshot };
}

test("version loading keeps old audio playing and switches at its advanced position", async () => {
  const { playback, media, plays, fades, state } = setup();
  const first = playback.select(source("first"));
  media[0].ready();
  await first;
  assert.equal(plays.length, 0, "metadata preloading is not playback");
  await playback.play();
  media[0].currentTime = 10;
  const next = playback.select(source("next"));
  assert.equal(media[0].paused, false);
  assert.equal(state().source?.versionId, "first");
  assert.equal(state().loading, true);
  media[0].currentTime = 14;
  media[1].ready();
  await next;
  assert.equal(media[1].currentTime, 14);
  assert.equal(state().source?.versionId, "next");
  assert.equal(state().loading, false);
  assert.equal(plays.at(-1)?.silent, true);
  assert.equal(fades.length, 1);
  playback.dispose();
  assert.ok(media.every((audio) => audio.paused && !audio.src));
});

test("paused changes stay paused and shorter versions start at zero", async () => {
  const { playback, media, plays, state } = setup();
  const first = playback.select(source("first"));
  media[0].ready();
  await first;
  media[0].currentTime = 50;
  const next = playback.select(source("short"));
  media[1].duration = 30;
  media[1].ready(1);
  await next;
  assert.equal(state().source?.versionId, "short");
  assert.equal(media[1].paused, true);
  assert.equal(media[1].currentTime, 0);
  assert.equal(plays.length, 0);
  playback.dispose();
});

test("rapid selection discards stale loads; failure preserves audible audio", async () => {
  const { playback, media, state } = setup();
  const first = playback.select(source("first"));
  media[0].ready();
  await first;
  await playback.play();
  const abandoned = playback.select(source("abandoned"));
  const failure = playback.select(source("failure"));
  media[1].ready();
  await abandoned;
  assert.equal(media[1].src, "");
  media[2].error = new Error("Network failure");
  media[2].dispatchEvent(new Event("error"));
  await failure;
  assert.equal(state().source?.versionId, "first");
  assert.equal(media[0].paused, false);
  assert.match(state().error, /could not be loaded/);
  const retry = playback.select(source("failure"));
  media[3].ready();
  await retry;
  assert.equal(state().source?.versionId, "failure");
  playback.dispose();
});

test("pausing during preparation keeps both versions paused and preserves feedback seeks", async () => {
  const { playback, media, state, fades } = setup();
  const first = playback.select(source("first"));
  media[0].ready();
  await first;
  await playback.play();
  const next = playback.select(source("next"));
  playback.seek("next", 23);
  playback.pause();
  media[1].ready();
  await next;
  assert.equal(state().source?.versionId, "next");
  assert.equal(media[1].currentTime, 23);
  assert.ok(media.every((audio) => audio.paused));
  assert.equal(fades.length, 0);
  playback.dispose();
});

test("repeat is native on current and pending versions; revocation aborts all audio", async () => {
  const { playback, media, state } = setup();
  const first = playback.select(source("first"));
  playback.setRepeat(true);
  media[0].ready();
  await first;
  await playback.play();
  const next = playback.select(source("next"));
  assert.ok(media.every((audio) => audio.loop));
  playback.setRepeat(false);
  assert.ok(media.every((audio) => !audio.loop));
  playback.reconcile(["next"]);
  media[1].ready();
  await next;
  assert.equal(state().source, null);
  assert.ok(media.every((audio) => audio.paused && !audio.src));
});

test("a rejected old play cannot cancel a later resume or version change", async () => {
  const media: Media[] = [];
  let reject!: (error: Error) => void;
  const interrupted = new Promise<void>((_, fail) => {
    reject = fail;
  });
  let calls = 0;
  const playback = new DemoPlayback(
    () => {
      const audio = new Media();
      media.push(audio);
      return audio as unknown as PlaybackMedia;
    },
    (audio) => (++calls === 1 ? interrupted : audio.play()),
    () => {},
  );
  const initial = playback.select(source("first"));
  media[0].ready();
  await initial;
  const oldPlay = playback.play();
  playback.pause();
  await playback.play();
  reject(new DOMException("Interrupted", "AbortError"));
  await oldPlay;
  const next = playback.select(source("next"));
  media[1].ready();
  await next;
  assert.equal(media[1].paused, false);
  assert.equal(playback.getSnapshot().error, "");
  playback.dispose();
});

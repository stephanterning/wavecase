import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReleasePlayback,
  type ReleaseQueue,
} from "../app/components/release-playback";

class Media extends EventTarget {
  src = "";
  currentTime = 0;
  duration = 60;
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  async play() {
    this.paused = false;
    this.ended = false;
    this.dispatchEvent(new Event("play"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  load() {
    this.currentTime = 0;
    this.error = null;
    this.ended = false;
  }
  removeAttribute() {
    this.src = "";
  }
  playing() {
    this.dispatchEvent(new Event("playing"));
  }
  finish() {
    this.currentTime = this.duration;
    this.paused = true;
    this.ended = true;
    this.dispatchEvent(new Event("ended"));
  }
}
const release = (id = "a", countPlays = true): ReleaseQueue => ({
  releaseId: id,
  url: `/artists/artist/${id}`,
  title: id,
  artwork: { src: `/artwork/${id}` },
  countPlays,
  tracks: [1, 2, 3].map((n) => ({
    id: `${id}${n}`,
    title: `Track ${n}`,
    artist: "Artist",
    duration: 60,
    gainDb: -n,
  })),
});
function setup(
  playAudio?: (media: HTMLAudioElement, gainDb: number) => Promise<void>,
) {
  const media = new Media();
  const plays: string[] = [];
  const gains: number[] = [];
  const playback = new ReleasePlayback(
    playAudio ||
      ((audio, gain) => {
        gains.push(gain);
        return audio.play();
      }),
    (release, track) => plays.push(`${release}/${track}`),
  );
  const detach = playback.attach(media as unknown as HTMLAudioElement);
  return { media, playback, plays, gains, detach, state: playback.getSnapshot };
}

test("selected track replaces the queue; pause and resume preserve it and the position", async () => {
  const { media, playback, state, plays } = setup();
  playback.start(release(), "a2");
  assert.deepEqual(
    state().queue?.tracks.map((t) => t.id),
    ["a2", "a3"],
  );
  assert.deepEqual(plays, [], "a requested play is not delivered audio");
  media.playing();
  playback.seek(23);
  playback.start(release(), "a2");
  assert.equal(media.paused, true);
  assert.equal(state().position, 23);
  const queue = state().queue;
  playback.start(release(), "a2");
  media.playing();
  assert.equal(media.currentTime, 23);
  assert.equal(state().queue, queue);
  assert.deepEqual(plays, ["a/a2"]);
  playback.start(release("b"), "b1");
  media.playing();
  assert.equal(state().queue?.url, "/artists/artist/b");
  assert.deepEqual(
    state().queue?.tracks.map((t) => t.id),
    ["b1", "b2", "b3"],
  );
  assert.deepEqual(plays, ["a/a2", "b/b1"]);
  await playback.play();
});

test("automatic progression keeps the original queue and replay restarts at its first track", async () => {
  const { media, playback, state, plays, gains } = setup();
  playback.start(release(), "a2");
  media.playing();
  media.finish();
  media.playing();
  assert.equal(state().queue?.tracks[state().index].id, "a3");
  assert.deepEqual(gains, [-2, -3]);
  media.finish();
  assert.equal(state().status, "ended");
  assert.equal(state().position, 60);
  assert.equal(state().queue?.tracks[state().index].title, "Track 3");
  assert.equal(state().queue?.artwork?.src, "/artwork/a");
  assert.deepEqual(plays, ["a/a2", "a/a3"]);
  await playback.play(); // Shared by the mini player and lock-screen Play.
  media.playing();
  assert.equal(state().queue?.tracks[state().index].id, "a2");
  assert.equal(state().position, 0);
  assert.deepEqual(plays, ["a/a2", "a/a3", "a/a2"]);
});

test("page refreshes do not replace a queue; revoked availability stops buffered audio", () => {
  const { media, playback, state } = setup();
  playback.start(release(), "a2");
  media.playing();
  playback.seek(17);
  const queue = state().queue;
  playback.reconcile("b", []);
  playback.reconcile("a", ["a1", "a2", "a3"]);
  assert.equal(state().queue, queue);
  assert.equal(media.currentTime, 17);
  assert.equal(media.paused, false);
  playback.reconcile("a", []);
  assert.equal(media.paused, true);
  assert.equal(media.src, "");
  assert.equal(state().queue, null);
  assert.match(state().error, /availability/);
});

test("a late rejection from the previous track does not overwrite the new track's state", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, fail) => {
    reject = fail;
  });
  let calls = 0;
  const { playback, media, state } = setup((audio) =>
    ++calls === 1 ? pending : audio.play(),
  );
  playback.start(release(), "a1");
  playback.start(release("b"), "b2");
  media.playing();
  reject(new Error("Old request aborted"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state().status, "playing");
  assert.equal(state().error, "");
  assert.equal(state().queue?.releaseId, "b");
});

test("media failures stop instead of advancing, and owner playback is not counted", () => {
  const { media, playback, state, plays } = setup();
  playback.start(release("a", false), "a1");
  media.playing();
  assert.deepEqual(plays, []);
  media.error = { code: 3 };
  media.dispatchEvent(new Event("error"));
  assert.equal(media.paused, true);
  assert.equal(state().status, "error");
  assert.equal(state().index, 0);
  assert.match(state().error, /unavailable/);
});

test("leaving the public layout stops audio, releases its source and removes listeners", () => {
  const { media, playback, state, detach } = setup();
  playback.start(release(), "a1");
  media.playing();
  detach();
  assert.equal(media.paused, true);
  assert.equal(media.src, "");
  const before = state();
  media.finish();
  assert.equal(state(), before);
  assert.equal(media.src, "");
});

test("pausing an unfinished play is not a playback error", async () => {
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((_, fail) => {
    reject = fail;
  });
  const { playback, media, state } = setup(() => pending);
  playback.start(release(), "a1");
  media.pause();
  reject(new DOMException("Play interrupted", "AbortError"));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(state().status, "paused");
  assert.equal(state().error, "");
});

test("seeking after the queue ends allows a new counted play of the last track", async () => {
  const { playback, media, plays } = setup();
  playback.start(release(), "a3");
  media.playing();
  media.finish();
  playback.seek(10);
  await playback.play();
  media.playing();
  assert.deepEqual(plays, ["a/a3", "a/a3"]);
});

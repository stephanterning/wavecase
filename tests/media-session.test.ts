import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { attachMediaSession } from "../app/components/media-session";

class Media extends EventTarget {
  currentTime = 0;
  duration = 60;
  playbackRate = 1;
  paused = true;
  ended = false;
  error: { code: number } | null = null;
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
}

function browserSession(t: TestContext) {
  const previous = new Map(
    ["navigator", "window", "MediaMetadata"].map((key) => [
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
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const session = {
    metadata: null as MediaMetadataInit | null,
    position: undefined as MediaPositionState | undefined,
    playbackState: "none",
    setPositionState(state?: MediaPositionState) {
      this.position = state;
    },
    setActionHandler(
      action: string,
      handler: MediaSessionActionHandler | null,
    ) {
      handlers.set(action, handler);
    },
  };
  const browser = { mediaSession: session };
  const metadata = () => session.metadata;
  for (const [key, value] of Object.entries({
    navigator: browser,
    window: new EventTarget(),
    MediaMetadata: class {
      constructor(metadata: MediaMetadataInit) {
        Object.assign(this, metadata);
      }
    },
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  return { session, handlers, browser, metadata };
}

test("native audio owns the timeline and state while remote commands control the element", async (t) => {
  const { session, handlers, browser } = browserSession(t);
  Object.assign(browser, { vendor: "Apple Computer, Inc." });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  Object.defineProperty(session, "playbackState", {
    get: () => "none",
    set: () => assert.fail("do not override the native playback state"),
  });
  t.mock.method(session, "setPositionState", () => {
    assert.fail("do not override the native timeline");
  });
  const media = new Media();
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Demo" },
    () => {},
  );
  const seekTo = handlers.get("seekto");
  handlers.get("play")!({ action: "play" });
  assert.equal(media.paused, false);
  for (const event of [
    "playing",
    "waiting",
    "timeupdate",
    "wavecase-loop",
    "seeking",
    "seeked",
    "durationchange",
  ])
    media.dispatchEvent(new Event(event));
  t.mock.timers.tick(1000);
  assert.equal(
    handlers.get("seekto"),
    seekTo,
    "playback never removes or replaces seeking commands",
  );
  media.currentTime = 23;
  handlers.get("seekbackward")!({ action: "seekbackward" });
  assert.equal(media.currentTime, 13);
  handlers.get("seekforward")!({ action: "seekforward" });
  assert.equal(media.currentTime, 23);
  handlers.get("seekforward")!({ action: "seekforward", seekOffset: 100 });
  assert.equal(media.currentTime, 60);
  handlers.get("seekbackward")!({ action: "seekbackward", seekOffset: 100 });
  assert.equal(media.currentTime, 0);
  handlers.get("pause")!({ action: "pause" });
  handlers.get("seekto")!({ action: "seekto", seekTime: 35 });
  assert.equal(media.currentTime, 35);
  assert.equal(media.paused, true);
  handlers.get("seekto")!({ action: "seekto", seekTime: NaN });
  assert.equal(media.currentTime, 35);
  assert.equal(handlers.get("previoustrack"), null);
  assert.equal(handlers.get("nexttrack"), null);
  stop();
  assert.ok([...handlers.values()].every((handler) => handler === null));
});

test("metadata follows the selected source and clears on failure, revocation and exit", async (t) => {
  const { session, handlers } = browserSession(t);
  const media = new Media();
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Track", artist: "Artist", artwork: [{ src: "/cover/private" }] },
    () => {},
  );
  assert.equal((session.metadata as MediaMetadataInit | null)?.title, "Track");
  media.dispatchEvent(new Event("error"));
  assert.equal(
    session.metadata,
    null,
    "also clear hls.js errors without media.error",
  );
  await media.play();
  assert.equal((session.metadata as MediaMetadataInit | null)?.title, "Track");
  media.error = { code: 3 };
  media.dispatchEvent(new Event("error"));
  media.pause();
  assert.equal(session.metadata, null);
  media.error = null;
  await media.play();
  window.dispatchEvent(new Event("wavecase-access-revoked"));
  assert.equal(session.metadata, null);
  assert.ok([...handlers.values()].every((handler) => handler === null));
  await media.play();
  assert.equal(session.metadata, null);
  stop();
});

test("unsupported media actions and rejected playback remain handled", async (t) => {
  const { session, handlers } = browserSession(t);
  const original = session.setActionHandler.bind(session);
  t.mock.method(
    session,
    "setActionHandler",
    (action: string, handler: MediaSessionActionHandler | null) => {
      if (action === "seekto") throw new Error("Unsupported action");
      original(action, handler);
    },
  );
  const media = new Media();
  let errors = 0;
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Track" },
    () => {
      errors++;
    },
    async () => {
      throw new Error("Playback failed");
    },
  );
  handlers.get("play")!({ action: "play" });
  await Promise.resolve();
  assert.equal(errors, 1);
  assert.doesNotThrow(stop);
});

test("queue controls use the shared player and disable next at the queue boundary", (t) => {
  const { handlers } = browserSession(t);
  const media = new Media();
  let previous = 0;
  let next = 0;
  let sought = 0;
  const attach = (canNext: boolean) =>
    attachMediaSession(
      media as unknown as HTMLAudioElement,
      { title: "Release track" },
      () => {},
      () => media.play(),
      undefined,
      {
        seek: (position) => {
          sought = position;
          media.currentTime = position;
        },
        previousTrack: () => {
          previous++;
        },
        nextTrack: canNext
          ? () => {
              next++;
            }
          : undefined,
      },
    );
  const stop = attach(true);
  handlers.get("seekto")!({ action: "seekto", seekTime: 23 });
  assert.equal(sought, 23);
  handlers.get("previoustrack")!({ action: "previoustrack" });
  handlers.get("nexttrack")!({ action: "nexttrack" });
  assert.equal(previous, 1);
  assert.equal(next, 1);
  assert.equal(handlers.get("seekbackward"), null);
  assert.equal(handlers.get("seekforward"), null);
  stop();
  const stopLast = attach(false);
  assert.equal(handlers.get("nexttrack"), null);
  assert.ok(handlers.get("previoustrack"));
  stopLast();
  assert.ok([...handlers.values()].every((handler) => handler === null));
});

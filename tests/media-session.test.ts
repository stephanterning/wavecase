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

test("lock-screen controls publish metadata and play/pause without track time or seeking", async (t) => {
  const { session, handlers, metadata } = browserSession(t);
  session.position = { duration: 60, position: 20, playbackRate: 1 };
  const positions: (MediaPositionState | undefined)[] = [];
  const original = session.setPositionState.bind(session);
  t.mock.method(session, "setPositionState", (state?: MediaPositionState) => {
    positions.push(state);
    original(state);
  });
  const media = new Media();
  let plays = 0;
  let pauses = 0;
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    {
      title: "Demo",
      artist: "Artist",
      album: "Album",
      artwork: [{ src: "/private-cover" }],
    },
    () => {},
    () => {
      plays++;
      return media.play();
    },
    () => {
      pauses++;
      media.pause();
    },
  );
  assert.equal(metadata()?.title, "Demo");
  assert.equal(metadata()?.artist, "Artist");
  assert.deepEqual(metadata()?.artwork, [{ src: "/private-cover" }]);
  assert.equal(
    session.position,
    undefined,
    "discard a previous player's timeline",
  );
  const disabled = [
    "seekto",
    "seekbackward",
    "seekforward",
    "previoustrack",
    "nexttrack",
  ];
  for (const action of disabled) assert.equal(handlers.get(action), null);
  assert.equal(session.playbackState, "paused");
  handlers.get("play")!({ action: "play" });
  assert.equal(plays, 1, "remote play uses the existing normalized transport");
  assert.equal(session.playbackState, "playing");
  media.currentTime = 35;
  for (const event of [
    "timeupdate",
    "loadedmetadata",
    "durationchange",
    "waiting",
    "playing",
    "seeking",
    "seeked",
    "wavecase-loop",
    "ratechange",
  ])
    media.dispatchEvent(new Event(event));
  assert.deepEqual(
    positions,
    [undefined],
    "transport events never publish time",
  );
  assert.equal(session.playbackState, "playing");
  for (const action of disabled) assert.equal(handlers.get(action), null);
  handlers.get("pause")!({ action: "pause" });
  assert.equal(pauses, 1);
  assert.equal(media.paused, true);
  assert.equal(session.playbackState, "paused");
  media.ended = true;
  media.dispatchEvent(new Event("ended"));
  assert.equal(session.playbackState, "paused");
  stop();
  assert.equal(metadata(), null);
  assert.equal(session.playbackState, "none");
  assert.deepEqual(positions, [undefined, undefined]);
  assert.ok([...handlers.values()].every((handler) => handler === null));
  await media.play();
  assert.equal(
    session.playbackState,
    "none",
    "exit removes transport listeners",
  );
});

test("release queue controls use the shared player and disable next at the queue end", async (t) => {
  const { session, handlers } = browserSession(t);
  let assignments = 0;
  let current = session.metadata;
  Object.defineProperty(session, "metadata", {
    get: () => current,
    set: (value: MediaMetadataInit | null) => {
      assignments++;
      current = value;
    },
  });
  const media = new Media();
  let previous = 0;
  let next = 0;
  const attach = (canNext: boolean) =>
    attachMediaSession(
      media as unknown as HTMLAudioElement,
      { title: "Release track" },
      () => {},
      () => media.play(),
      undefined,
      {
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
  handlers.get("previoustrack")!({ action: "previoustrack" });
  handlers.get("nexttrack")!({ action: "nexttrack" });
  assert.equal(previous, 1);
  assert.equal(next, 1);
  for (const action of ["seekto", "seekbackward", "seekforward"])
    assert.equal(handlers.get(action), null);
  assignments = 0;
  await media.play();
  media.pause();
  assert.equal(assignments, 0, "unchanged metadata is not reassigned");
  stop();
  const stopLast = attach(false);
  assert.equal(handlers.get("nexttrack"), null);
  assert.ok(handlers.get("previoustrack"));
  stopLast();
  assert.ok([...handlers.values()].every((handler) => handler === null));
});

test("media failure and revocation clear private metadata and remote controls", async (t) => {
  const { session, handlers, metadata } = browserSession(t);
  const media = new Media();
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Private demo" },
    () => {},
  );
  await media.play();
  media.error = { code: 3 };
  media.dispatchEvent(new Event("error"));
  media.pause();
  assert.equal(metadata(), null);
  assert.equal(session.playbackState, "none");
  media.error = null;
  await media.play();
  assert.equal(metadata()?.title, "Private demo");
  window.dispatchEvent(new Event("wavecase-access-revoked"));
  assert.equal(metadata(), null);
  assert.ok([...handlers.values()].every((handler) => handler === null));
  stop();
});

test("partial Media Session support and rejected remote playback are handled", async (t) => {
  const { session, handlers, browser } = browserSession(t);
  const original = session.setActionHandler.bind(session);
  t.mock.method(
    session,
    "setActionHandler",
    (action: string, handler: MediaSessionActionHandler | null) => {
      if (action === "seekto") throw new Error("Unsupported action");
      original(action, handler);
    },
  );
  t.mock.method(session, "setPositionState", () => {
    throw new Error("Unsupported position API");
  });
  const media = new Media();
  let failures = 0;
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Track" },
    () => {
      failures++;
    },
    async () => {
      throw new Error("Interrupted");
    },
  );
  handlers.get("play")!({ action: "play" });
  await Promise.resolve();
  assert.equal(failures, 1);
  assert.doesNotThrow(stop);
  Reflect.deleteProperty(session, "setPositionState");
  assert.doesNotThrow(() =>
    attachMediaSession(
      media as unknown as HTMLAudioElement,
      { title: "Track" },
      () => {},
    )(),
  );
  Reflect.deleteProperty(browser, "mediaSession");
  assert.doesNotThrow(() =>
    attachMediaSession(
      media as unknown as HTMLAudioElement,
      { title: "Track" },
      () => {},
    )(),
  );
});

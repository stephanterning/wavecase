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

const frozen = (state?: MediaPositionState) =>
  (state?.playbackRate ?? 1) < 0.001;

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

test("media sessions show the current track and clear private metadata and controls", async (t) => {
  const { session, handlers, browser, metadata } = browserSession(t);
  const media = new Media();
  let errors = 0;
  let normalizedPlays = 0;
  const attach = (metadata: MediaMetadataInit) =>
    attachMediaSession(
      media as unknown as HTMLAudioElement,
      metadata,
      () => {
        errors++;
      },
      () => {
        normalizedPlays++;
        return media.play();
      },
    );
  const stopDemo = attach({
    title: "Demo title",
    artist: "Demo artist",
    artwork: [{ src: "/cover/demo?share=private-link" }],
  });
  assert.equal(session.metadata?.title, "Demo title");
  assert.equal(session.metadata?.artist, "Demo artist");
  assert.deepEqual(session.metadata?.artwork, [
    { src: "/cover/demo?share=private-link" },
  ]);
  assert.equal(session.playbackState, "paused");
  handlers.get("play")!({ action: "play" });
  assert.equal(media.paused, false);
  assert.equal(
    normalizedPlays,
    1,
    "lock-screen play uses the normalization callback",
  );
  assert.equal(session.playbackState, "playing");
  handlers.get("seekto")!({ action: "seekto", seekTime: 23 });
  assert.equal(media.currentTime, 23);
  handlers.get("pause")!({ action: "pause" });
  assert.equal(media.paused, true);
  assert.equal(session.playbackState, "paused");

  // A decoder/network error can stop audio without setting paused or firing pause.
  await media.play();
  media.error = { code: 3 };
  media.dispatchEvent(new Event("error"));
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, "none");
  assert.equal(session.position, undefined);
  media.pause();
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, "none");
  // Reloading a valid source clears the media error; playback restores metadata.
  media.error = null;
  handlers.get("play")!({ action: "play" });
  assert.equal(metadata()?.title, "Demo title");
  assert.equal(session.playbackState, "playing");

  window.dispatchEvent(new Event("wavecase-access-revoked"));
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, "none");
  assert.ok([...handlers.values()].every((handler) => handler === null));
  assert.equal(session.position, undefined);
  await media.play();
  assert.equal(session.playbackState, "none");
  stopDemo();

  const stopRelease = attach({
    title: "First release track",
    artist: "Guest artist",
    album: "Release title",
    artwork: [
      {
        src: "/release-assets/release/artwork.jpg?v=cover.png",
        sizes: "512x512",
        type: "image/jpeg",
      },
    ],
  });
  assert.equal(metadata()?.album, "Release title");
  assert.deepEqual(metadata()?.artwork, [
    {
      src: "/release-assets/release/artwork.jpg?v=cover.png",
      sizes: "512x512",
      type: "image/jpeg",
    },
  ]);
  assert.equal(session.playbackState, "playing");
  stopRelease();
  const stopNext = attach({ title: "Next track", artist: "", artwork: [] });
  assert.equal(metadata()?.title, "Next track");
  assert.equal(metadata()?.artist, "");
  assert.deepEqual(metadata()?.artwork, []);
  media.ended = true;
  media.dispatchEvent(new Event("ended"));
  assert.equal(session.playbackState, "paused");
  t.mock.method(media, "play", async () => {
    throw new Error("Playback denied");
  });
  handlers.get("play")!({ action: "play" });
  await Promise.resolve();
  assert.equal(errors, 1);
  stopNext();
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, "none");

  t.mock.method(
    session,
    "setActionHandler",
    (action: string, handler: MediaSessionActionHandler | null) => {
      if (action === "seekto") throw new Error("Unsupported action");
      handlers.set(action, handler);
    },
  );
  const stopPartial = attach({ title: "Partial browser support" });
  assert.ok(handlers.get("play"));
  assert.doesNotThrow(stopPartial);
  Reflect.deleteProperty(globalThis, "MediaMetadata");
  assert.doesNotThrow(() => attach({ title: "No metadata API" })());
  Reflect.deleteProperty(browser, "mediaSession");
  assert.doesNotThrow(() => attach({ title: "No media session API" })());
});

test("media sessions report duration, position and rate through the playback lifecycle", async (t) => {
  const { session } = browserSession(t);
  const position = () => session.position;
  const media = new Media();
  media.duration = NaN;
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Track" },
    () => {},
  );
  assert.equal(position(), undefined, "metadata may not be loaded yet");
  media.duration = 120;
  media.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(position()?.duration, 120);
  assert.equal(position()?.position, 0);
  assert.ok(frozen(position()), "a paused timeline is frozen");
  await media.play();
  assert.equal(position()?.playbackRate, 1);
  media.currentTime = 32;
  media.dispatchEvent(new Event("timeupdate"));
  assert.equal(position()?.position, 32);
  media.pause();
  assert.equal(position()?.position, 32);
  assert.ok(frozen(position()));
  assert.equal(session.playbackState, "paused");
  media.currentTime = 50;
  media.dispatchEvent(new Event("seeked"));
  assert.equal(position()?.position, 50);
  await media.play();
  media.playbackRate = 1.5;
  media.dispatchEvent(new Event("ratechange"));
  assert.equal(position()?.playbackRate, 1.5);
  media.playbackRate = 1;
  media.duration = 90;
  media.dispatchEvent(new Event("durationchange"));
  assert.equal(position()?.duration, 90);
  media.currentTime = 90;
  media.ended = true;
  media.dispatchEvent(new Event("ended"));
  assert.equal(position()?.position, 90);
  assert.equal(session.playbackState, "paused");

  media.duration = NaN;
  media.dispatchEvent(new Event("emptied"));
  assert.equal(position(), undefined, "a new source clears the old timeline");
  media.duration = 30;
  media.currentTime = 0;
  media.dispatchEvent(new Event("loadedmetadata"));
  assert.equal(position()?.duration, 30);
  stop();
  assert.equal(position(), undefined);
  media.dispatchEvent(new Event("timeupdate"));
  assert.equal(position(), undefined, "cleanup removes timeline listeners");
});

test("repeats and stalls refresh the lock-screen timeline while playing", async (t) => {
  const { session } = browserSession(t);
  const states: string[] = [];
  let state = session.playbackState;
  Object.defineProperty(session, "playbackState", {
    get: () => state,
    set: (value: string) => {
      // Browsers ignore assignments of the current state.
      if (value !== state)
        states.push(`${value}@${session.position?.position}`);
      state = value;
    },
  });
  const media = new Media();
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Track" },
    () => {},
  );
  await media.play();
  media.currentTime = 59.9;
  media.dispatchEvent(new Event("timeupdate"));
  states.length = 0;
  media.currentTime = 0.1;
  media.dispatchEvent(new Event("wavecase-loop"));
  assert.deepEqual(
    states,
    ["paused@0.1", "playing@0.1"],
    "the wrapped position is reported before the state change",
  );
  assert.equal(session.position?.playbackRate, 1);

  states.length = 0;
  media.dispatchEvent(new Event("waiting"));
  assert.ok(frozen(session.position), "a stall freezes");
  assert.deepEqual(states, ["paused@0.1", "playing@0.1"]);
  media.dispatchEvent(new Event("timeupdate"));
  assert.equal(states.length, 2, "position updates alone do not re-announce");
  media.currentTime = 0.2;
  media.dispatchEvent(new Event("playing"));
  assert.equal(session.position?.playbackRate, 1);
  assert.deepEqual(states.slice(2), ["paused@0.2", "playing@0.2"]);

  states.length = 0;
  media.pause();
  assert.deepEqual(states, ["paused@0.2"]);
  assert.ok(frozen(session.position));
  media.dispatchEvent(new Event("wavecase-loop"));
  assert.deepEqual(states, ["paused@0.2"], "paused loops are not announced");
  stop();
});

test("single-track back controls restart the demo and forward seeks stay within the track", (t) => {
  const { session, handlers } = browserSession(t);
  const media = new Media();
  media.currentTime = 23;
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Demo" },
    () => {},
  );
  handlers.get("seekbackward")!({ action: "seekbackward" });
  assert.equal(media.currentTime, 0);
  assert.equal(session.position?.position, 0);
  handlers.get("seekforward")!({ action: "seekforward", seekOffset: 20 });
  assert.equal(media.currentTime, 20);
  handlers.get("seekbackward")!({ action: "seekbackward", seekOffset: 50 });
  assert.equal(media.currentTime, 0);
  handlers.get("seekforward")!({ action: "seekforward", seekOffset: 100 });
  assert.equal(media.currentTime, 60);
  handlers.get("seekto")!({ action: "seekto", seekTime: 17 });
  assert.equal(media.currentTime, 17);
  handlers.get("seekto")!({ action: "seekto", seekTime: NaN });
  assert.equal(media.currentTime, 17);
  handlers.get("previoustrack")!({ action: "previoustrack" });
  assert.equal(media.currentTime, 0, "Previous restarts the current demo");
  assert.equal(session.position?.position, 0);
  media.duration = NaN;
  handlers.get("seekforward")!({ action: "seekforward" });
  assert.equal(media.currentTime, 0, "wait for a seekable duration");
  assert.equal(media.paused, true, "seeking does not start playback");
  assert.ok(handlers.get("previoustrack"));
  assert.equal(handlers.get("nexttrack"), null);
  stop();
});

test("WebKit seeking is re-enabled after Now Playing becomes seekable, including after resume", async (t) => {
  const { session, handlers, browser } = browserSession(t);
  Object.assign(browser, { vendor: "Apple Computer, Inc." });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let seekable = false;
  let enabled = false;
  let previousCommands = "";
  let update: ReturnType<typeof setTimeout>;
  // Model WebKit 326021: the native command list is cached by action names,
  // ignoring the later transition from non-seekable to seekable output.
  session.setActionHandler = (action, handler) => {
    handlers.set(action, handler);
    clearTimeout(update);
    update = setTimeout(() => {
      const commands = [...handlers]
        .filter(([, handler]) => handler)
        .map(([action]) => action)
        .join(",");
      if (commands === previousCommands) return;
      previousCommands = commands;
      enabled = seekable && !!handlers.get("seekto");
    }, 1);
  };
  const media = new Media();
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Demo" },
    () => {},
  );
  t.mock.timers.tick(1);
  assert.equal(enabled, false);
  seekable = true;
  await media.play();
  media.dispatchEvent(new Event("playing"));
  t.mock.timers.tick(1);
  t.mock.timers.tick(100);
  t.mock.timers.tick(1);
  assert.equal(enabled, true);
  handlers.get("seekto")!({ action: "seekto", seekTime: 42 });
  assert.equal(media.currentTime, 42);
  media.pause();
  handlers.get("seekto")!({ action: "seekto", seekTime: 12 });
  assert.equal(media.currentTime, 12, "paused seeking remains available");
  await media.play();
  media.dispatchEvent(new Event("playing"));
  stop();
  t.mock.timers.tick(1000);
  assert.equal(enabled, false);
  assert.ok(
    [...handlers.values()].every((handler) => handler === null),
    "leaving the player cancels delayed command registration",
  );
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

test("invalid timing and partial position APIs do not break playback controls", (t) => {
  const { session, handlers } = browserSession(t);
  const media = new Media();
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Track" },
    () => {},
  );
  for (const duration of [NaN, Infinity, 0, -1]) {
    media.duration = duration;
    media.dispatchEvent(new Event("durationchange"));
    assert.equal(session.position, undefined);
  }
  media.duration = 60;
  media.currentTime = 70;
  media.dispatchEvent(new Event("timeupdate"));
  assert.equal(session.position?.position, 60);
  media.currentTime = -1;
  media.dispatchEvent(new Event("timeupdate"));
  assert.equal(session.position?.position, 0);
  media.playbackRate = 0;
  media.dispatchEvent(new Event("ratechange"));
  assert.equal(session.position, undefined);
  t.mock.method(session, "setPositionState", () => {
    throw new Error("Unsupported");
  });
  assert.doesNotThrow(() => handlers.get("pause")!({ action: "pause" }));
  assert.doesNotThrow(stop);
  Reflect.deleteProperty(session, "setPositionState");
  assert.doesNotThrow(() =>
    attachMediaSession(
      media as unknown as HTMLAudioElement,
      { title: "No position API" },
      () => {},
    )(),
  );
});

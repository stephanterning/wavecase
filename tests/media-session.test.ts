import { test } from "node:test";
import assert from "node:assert/strict";
import { attachMediaSession } from "../app/components/media-session";

class Media extends EventTarget {
  currentTime = 0;
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

test("media sessions show the current track and clear private metadata and controls", async (t) => {
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
    playbackState: "none",
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

  const media = new Media();
  let errors = 0;
  const attach = (metadata: MediaMetadataInit) =>
    attachMediaSession(media as unknown as HTMLAudioElement, metadata, () => {
      errors++;
    });
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

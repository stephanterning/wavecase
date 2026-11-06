import { test } from "node:test";
import assert from "node:assert/strict";
import {
  playbackContext,
  playbackDestination,
  resumePlayback,
  experimentalPlaybackOutput,
} from "../app/components/audio-context";
import { attachMediaSession } from "../app/components/media-session";
import { audioOutputMode } from "../app/components/audio-diagnostics";

test("opt-in stream output couples native and application controls without stale pause or initial cancellation", async (t) => {
  const keys = ["window", "navigator", "Audio", "AudioContext"];
  const previous = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  t.after(() =>
    keys.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    }),
  );
  class Media extends EventTarget {
    paused = true;
    ended = false;
    error = null;
    srcObject: unknown;
    async play() {
      if (!this.paused) return;
      this.paused = false;
      queueMicrotask(() => this.dispatchEvent(new Event("play")));
    }
    pause() {
      if (this.paused) return;
      this.paused = true;
      queueMicrotask(() => this.dispatchEvent(new Event("pause")));
    }
  }
  const stream = {};
  class Context extends EventTarget {
    state = "running";
    destination = {};
    createMediaStreamDestination() {
      return { stream };
    }
    async resume() {
      this.state = "running";
    }
  }
  const window = Object.assign(new EventTarget(), {
    location: { search: "?audioOutput=element" },
  });
  for (const [key, value] of Object.entries({
    window,
    navigator: {
      vendor: "Apple Computer, Inc.",
      userAgent: "iPhone",
      maxTouchPoints: 5,
      mediaSession: {
        playbackState: "none",
        setActionHandler() {},
        setPositionState() {},
      },
    },
    Audio: Media,
    AudioContext: Context,
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const context = playbackContext();
  const destination = playbackDestination(context);
  assert.notEqual(destination, context.destination);
  assert.equal(playbackDestination(context), destination);
  const output = experimentalPlaybackOutput()!;
  assert.equal(output.srcObject, stream);
  const media = new Media();
  await output.play();
  const start = async () => {
    const playing = media.play();
    await Promise.all([playing, resumePlayback(context)]);
  };
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Test" },
    () => assert.fail("unexpected playback failure"),
    start,
  );
  assert.equal(
    output.paused,
    false,
    "attachment must not cancel a pending initial output start",
  );
  await start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  output.pause();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(media.paused, true, "native pause stops the transport");
  await output.play();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(media.paused, false, "native play restarts the transport");
  media.pause();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(output.paused, true, "application pause stops native output");
  await start();
  output.pause();
  await start();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    media.paused,
    false,
    "a queued pause must not pause a newer play",
  );
  window.location.search = "?audioOutput=direct";
  assert.equal(
    audioOutputMode(),
    "element",
    "output selection remains stable until reload",
  );
  stop();
  output.pause();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(
    media.paused,
    false,
    "detachment removes native control forwarding",
  );
});

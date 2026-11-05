import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  playbackDestination,
  resumePlayback,
} from "../app/components/audio-context";

function browser(t: TestContext, value: object) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator")!;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value,
  });
  t.after(() => {
    Object.defineProperty(globalThis, "navigator", previous);
  });
}

test("other browsers and mobile Safari retain their device destination", (t) => {
  const client = {
    vendor: "Google Inc.",
    userAgent: "Macintosh",
    maxTouchPoints: 0,
  };
  browser(t, client);
  const context = { destination: {} } as AudioContext;
  assert.equal(playbackDestination(context), context.destination);
  client.vendor = "Apple Computer, Inc.";
  client.userAgent = "iPhone";
  client.maxTouchPoints = 5;
  assert.equal(playbackDestination(context), context.destination);
  client.userAgent = "Macintosh"; // iPad's desktop website identity.
  assert.equal(playbackDestination(context), context.destination);
});

test("Mac Safari reuses media output and starts it alongside context resume", async (t) => {
  const session = { type: "auto" };
  browser(t, {
    vendor: "Apple Computer, Inc.",
    userAgent: "Macintosh",
    maxTouchPoints: 0,
    audioSession: session,
  });
  const calls: string[] = [];
  const media: Output[] = [];
  let rejectPlay = false;
  class Output {
    srcObject: unknown;
    constructor() {
      media.push(this);
    }
    play() {
      calls.push("play");
      return rejectPlay
        ? Promise.reject(new Error("Output interrupted"))
        : Promise.resolve();
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: Output,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Audio", previous);
    else Reflect.deleteProperty(globalThis, "Audio");
  });
  let finishResume!: () => void;
  const destination = { stream: {} };
  const fakeContext = {
    state: "suspended",
    destination: {},
    createMediaStreamDestination: () => destination,
    resume() {
      calls.push("resume");
      return new Promise<void>((resolve) => {
        finishResume = resolve;
      });
    },
  };
  const context = fakeContext as unknown as AudioContext;
  assert.equal(playbackDestination(context), destination);
  assert.equal(playbackDestination(context), destination);
  assert.equal(media.length, 1, "source changes share one device output");
  assert.equal(media[0].srcObject, destination.stream);
  const starting = resumePlayback(context);
  assert.deepEqual(
    calls,
    ["resume", "play"],
    "neither start waits for the other",
  );
  assert.equal(session.type, "playback");
  finishResume();
  await starting;
  fakeContext.state = "running";
  calls.length = 0;
  rejectPlay = true;
  await assert.rejects(resumePlayback(context), /Output interrupted/);
  assert.deepEqual(
    calls,
    ["play"],
    "output failures reach the player's retry flow",
  );
  rejectPlay = false;
  await resumePlayback(context);
  assert.equal(media.length, 1, "retry reuses the same stream");
});

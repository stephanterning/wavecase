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

test("other browsers retain their device destination", (t) => {
  browser(t, { vendor: "Google Inc.", userAgent: "Macintosh" });
  const context = { destination: {} } as AudioContext;
  assert.equal(playbackDestination(context), context.destination);
});

test("Apple WebKit reuses media output and starts it alongside context resume", async (t) => {
  const session = { type: "auto" };
  browser(t, {
    vendor: "Apple Computer, Inc.",
    userAgent: "iPhone",
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
      if (this.state === "running") return Promise.resolve();
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
    ["resume", "play"],
    "output failures reach the player's retry flow",
  );
  rejectPlay = false;
  await resumePlayback(context);
  assert.equal(media.length, 1, "retry reuses the same stream");
});

test("the output element pauses only after every transport stops", async (t) => {
  browser(t, { vendor: "Apple Computer, Inc." });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const events: string[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Audio");
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: class {
      srcObject: unknown;
      play() {
        events.push("play");
        return Promise.resolve();
      }
      pause() {
        events.push("pause");
      }
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Audio", previous);
    else Reflect.deleteProperty(globalThis, "Audio");
  });
  let finishSuspend!: () => void;
  let pendingSuspend = Promise.resolve();
  let resumes = 0;
  const fakeContext = {
    state: "running",
    resume() {
      resumes++;
      return pendingSuspend.then(() => {
        this.state = "running";
      });
    },
    suspend() {
      events.push("suspend");
      pendingSuspend = new Promise<void>((resolve) => {
        finishSuspend = () => {
          this.state = "suspended";
          resolve();
        };
      });
      return pendingSuspend;
    },
    createMediaStreamDestination: () => ({ stream: {} }),
  };
  const context = fakeContext as unknown as AudioContext;
  class Transport extends EventTarget {
    paused = true;
    ended = false;
    error = null;
    set(paused: boolean) {
      this.paused = paused;
      this.dispatchEvent(new Event(paused ? "pause" : "play"));
    }
  }
  const current = new Transport();
  const next = new Transport();
  playbackDestination(context, current);
  playbackDestination(context, current);
  playbackDestination(context, next);

  void resumePlayback(context);
  current.set(false);
  next.set(false);
  current.set(true);
  t.mock.timers.tick(1000);
  assert.deepEqual(events, ["play"], "a version handover keeps the output");

  next.set(true);
  t.mock.timers.tick(99);
  assert.deepEqual(events, ["play"], "the fade tail stays audible");
  t.mock.timers.tick(1);
  assert.deepEqual(
    events,
    ["play", "pause", "suspend"],
    "idle output also suspends its audio clock",
  );

  events.length = 0;
  next.set(false);
  next.set(true);
  const resumed = resumePlayback(context);
  assert.equal(
    fakeContext.state,
    "running",
    "idle suspend has not settled yet",
  );
  assert.equal(
    resumes,
    2,
    "resume must be queued even while state still reports running",
  );
  next.set(false);
  finishSuspend();
  await resumed;
  assert.equal(
    fakeContext.state,
    "running",
    "the pending suspend cannot strand a new start",
  );
  t.mock.timers.tick(1000);
  assert.deepEqual(events, ["play"], "a new start cancels the idle pause");
  next.ended = true;
  next.dispatchEvent(new Event("ended"));
  t.mock.timers.tick(100);
  assert.deepEqual(
    events,
    ["play", "pause", "suspend"],
    "ending releases the output",
  );
});

test("an interrupted startup times out and a later attempt can resume", async (t) => {
  browser(t, {});
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const context = {
    state: "interrupted",
    resume: () => new Promise<void>(() => {}),
  } as unknown as AudioContext;
  const starting = assert.rejects(resumePlayback(context), /did not resume/);
  t.mock.timers.tick(10_000);
  await starting;
  context.resume = async () => {};
  await resumePlayback(context);
});

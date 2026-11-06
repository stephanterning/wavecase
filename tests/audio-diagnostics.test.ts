import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachAudioDiagnostics,
  audioDiagnosticsReport,
  logAudio,
  observeAudioContext,
  observeAudioPromise,
} from "../app/components/audio-diagnostics";
import { attachMediaSession } from "../app/components/media-session";
import { resumePlayback } from "../app/components/audio-context";

test("diagnostics distinguish a remote play waiting for context resume until foreground", async (t) => {
  const keys = ["window", "document", "navigator", "PageTransitionEvent"];
  const previous = keys.map((key) =>
    Object.getOwnPropertyDescriptor(globalThis, key),
  );
  t.after(() =>
    keys.forEach((key, i) => {
      if (previous[i]) Object.defineProperty(globalThis, key, previous[i]!);
      else Reflect.deleteProperty(globalThis, key);
    }),
  );
  // Without a browser the observer returns the original promise unchanged.
  const original = Promise.resolve();
  assert.equal(
    observeAudioPromise("disabled", () => original),
    original,
  );
  const page = Object.assign(new EventTarget(), {
    location: { search: "?audioDebug=1&token=private-token" },
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const handlers = new Map<string, MediaSessionActionHandler>();
  const session = {
    playbackState: "none",
    setActionHandler: (key: string, handler: MediaSessionActionHandler) =>
      handlers.set(key, handler),
    setPositionState: () => {},
  };
  for (const [key, value] of Object.entries({
    window: page,
    document: doc,
    navigator: {
      mediaSession: session,
      audioSession: { type: "playback", state: "inactive" },
    },
    PageTransitionEvent: class extends Event {},
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  const detach = attachAudioDiagnostics();
  let resolve!: () => void;
  const pending = new Promise<void>((done) => {
    resolve = done;
  });
  const context = Object.assign(new EventTarget(), {
    state: "suspended",
    currentTime: 12,
    resume: () => pending,
  });
  observeAudioContext(context as unknown as AudioContext);
  const media = Object.assign(new EventTarget(), {
    paused: true,
    ended: false,
  });
  const stop = attachMediaSession(
    media as unknown as HTMLAudioElement,
    { title: "Private title", artwork: [{ src: "/secret-cover" }] },
    () => assert.fail("play should succeed"),
    () => resumePlayback(context as unknown as AudioContext),
  );
  doc.visibilityState = "hidden";
  doc.dispatchEvent(new Event("visibilitychange"));
  handlers.get("play")!({ action: "play" });
  let report = JSON.parse(audioDiagnosticsReport());
  assert.ok(
    report.entries.some(
      (entry: { event: string }) => entry.event === "remote.play:requested",
    ),
  );
  assert.ok(
    report.entries.some(
      (entry: { event: string }) => entry.event === "context.resume:requested",
    ),
  );
  assert.ok(
    !report.entries.some((entry: { event: string }) =>
      entry.event.endsWith(":resolved"),
    ),
  );
  doc.visibilityState = "visible";
  doc.dispatchEvent(new Event("visibilitychange"));
  context.state = "running";
  context.dispatchEvent(new Event("statechange"));
  resolve();
  await pending;
  await new Promise<void>((done) => setImmediate(done));
  report = JSON.parse(audioDiagnosticsReport());
  const requested = report.entries.find(
    (entry: { event: string }) => entry.event === "context.resume:requested",
  );
  const resumed = report.entries.find(
    (entry: { event: string }) => entry.event === "context.resume:resolved",
  );
  assert.equal(requested.visibility, "hidden");
  assert.equal(resumed.visibility, "visible");
  assert.equal(requested.attempt, resumed.attempt);
  assert.ok(
    report.entries.some(
      (entry: { event: string }) => entry.event === "remote.play:resolved",
    ),
  );
  await assert.rejects(
    observeAudioPromise("failure", () =>
      Promise.reject(new Error("private URL/token")),
    ),
  );
  const text = audioDiagnosticsReport();
  for (const secret of [
    "private-token",
    "Private title",
    "/secret-cover",
    "private URL/token",
  ])
    assert.ok(!text.includes(secret));
  stop();
  detach();
  const before = JSON.parse(audioDiagnosticsReport()).entries.length;
  doc.dispatchEvent(new Event("visibilitychange"));
  media.dispatchEvent(new Event("play"));
  assert.equal(JSON.parse(audioDiagnosticsReport()).entries.length, before + 1);
  for (let i = 0; i < 600; i++) logAudio("bounded");
  assert.equal(JSON.parse(audioDiagnosticsReport()).entries.length, 500);
});

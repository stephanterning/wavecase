import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePlayback } from "../app/components/audio-context";

test("worklets request playback while native normalization restores automatic session selection", async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator")!;
  const session = { type: "auto" };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { audioSession: session },
  });
  t.after(() => Object.defineProperty(globalThis, "navigator", previous));
  let resumes = 0;
  let fail = false;
  const context = {
    state: "suspended",
    async resume() {
      resumes++;
      if (fail) throw new Error("Context interrupted");
    },
  };
  await resumePlayback(context as unknown as AudioContext);
  assert.equal(resumes, 1);
  assert.equal(session.type, "playback");
  context.state = "running";
  await resumePlayback(context as unknown as AudioContext);
  assert.equal(resumes, 1);
  await resumePlayback(context as unknown as AudioContext, true);
  assert.equal(
    session.type,
    "auto",
    "native playback clears a previous forced Web Audio session",
  );
  assert.equal(
    resumes,
    1,
    "session selection also updates for an already running context",
  );
  await resumePlayback(context as unknown as AudioContext);
  assert.equal(
    session.type,
    "playback",
    "worklet playback still opts into background playback",
  );
  context.state = "suspended";
  fail = true;
  await assert.rejects(
    resumePlayback(context as unknown as AudioContext),
    /Context interrupted/,
  );
});

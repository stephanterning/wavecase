import { test } from "node:test";
import assert from "node:assert/strict";
import { resumePlayback } from "../app/components/audio-context";

test("normalization resumes its context and requests background playback without a second media element", async (t) => {
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
  context.state = "suspended";
  fail = true;
  await assert.rejects(
    resumePlayback(context as unknown as AudioContext),
    /Context interrupted/,
  );
});

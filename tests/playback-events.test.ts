import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { observeListening } from "../app/components/listening";
import {
  observePlaybackLoop,
  seekPlayback,
} from "../app/components/playback-audio";
class Storage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) || null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}
class Media extends EventTarget {
  currentTime = 0;
  paused = true;
  seeking = false;
  playbackRate = 1;
  loop = false;
  duration = 60;
}
function captureEvents(t: TestContext) {
  const previous = new Map(
    ["window", "localStorage", "sessionStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: Object.assign(new EventTarget(), {
      location: { origin: "http://localhost" },
    }),
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new Storage(),
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: new Storage(),
  });
  t.after(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const events: { kind: string; position: number; end?: number }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      events.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    },
  );
  return events;
}
test("visits and seeks do not count as plays; resume and repeat follow the agreed rules", async (t) => {
  const events = captureEvents(t);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const media = new Media();
  const stop = observeListening(
    media as unknown as HTMLAudioElement,
    "version",
    "share",
  );
  const emit = (name: string) => media.dispatchEvent(new Event(name));
  const move = (time: number) => {
    now += 1000;
    media.currentTime = time;
    emit("timeupdate");
  };
  const plays = () => events.filter((e) => e.kind === "play").length;
  try {
    assert.equal(plays(), 0);
    media.seeking = true;
    media.currentTime = 45;
    emit("seeking");
    media.seeking = false;
    emit("seeked");
    assert.equal(plays(), 0);
    media.paused = false;
    emit("playing");
    assert.equal(plays(), 1);
    assert.equal(events.find((e) => e.kind === "play")?.position, 45);
    move(46);
    move(47);
    t.mock.timers.tick(2000);
    assert.equal(plays(), 1);
    media.paused = true;
    emit("pause");
    media.paused = false;
    emit("playing");
    assert.equal(plays(), 1);
    media.seeking = true;
    media.currentTime = 0;
    emit("seeking");
    media.seeking = false;
    emit("seeked");
    emit("playing");
    move(1);
    assert.equal(plays(), 1);
    emit("ended");
    media.currentTime = 0;
    emit("playing");
    assert.equal(plays(), 2);
    assert.ok(
      events.some(
        (e) => e.kind === "interval" && e.position === 45 && e.end === 47,
      ),
    );
    assert.ok(
      events.some((e) => e.kind === "seek" && e.position === 47 && e.end === 0),
    );
  } finally {
    stop();
  }
});

test("native repeats close coverage and add one play, but user rewinds do not", (t) => {
  const events = captureEvents(t);
  t.mock.timers.enable({ apis: ["setInterval"] });
  const media = new Media();
  const audio = media as unknown as HTMLAudioElement;
  const stopLoop = observePlaybackLoop(audio);
  const stop = observeListening(audio, "version", "share");
  const emit = (name: string) => media.dispatchEvent(new Event(name));
  media.loop = true;
  media.paused = false;
  emit("playing");
  media.currentTime = 59.8;
  emit("timeupdate");
  media.seeking = true;
  media.currentTime = 0;
  emit("seeking");
  media.seeking = false;
  emit("seeked");
  emit("playing");
  emit("timeupdate");
  assert.equal(events.filter((e) => e.kind === "play").length, 2);
  assert.equal(events.filter((e) => e.kind === "ended").length, 1);
  assert.equal(events.filter((e) => e.kind === "seek").length, 0);
  assert.ok(events.some((e) => e.kind === "interval" && e.end === 60));
  media.currentTime = 59.9;
  emit("timeupdate");
  media.seeking = true;
  seekPlayback(audio, 0);
  emit("seeking");
  media.seeking = false;
  emit("seeked");
  emit("playing");
  assert.equal(events.filter((e) => e.kind === "play").length, 2);
  assert.equal(events.filter((e) => e.kind === "seek").length, 1);
  stop();
  stopLoop();
});

test("version changes record the restored position without a seek or unplayed coverage", (t) => {
  const events = captureEvents(t);
  let now = 0;
  t.mock.method(performance, "now", () => now);
  t.mock.timers.enable({ apis: ["setInterval"] });

  // A shorter destination starts at zero; a paused switch still records the
  // version change but adds no play until the listener starts the audio.
  for (const position of [94, 0]) {
    for (const paused of [false, true]) {
      events.length = 0;
      const media = new Media();
      media.currentTime = position;
      media.seeking = true;
      const stop = observeListening(
        media as unknown as HTMLAudioElement,
        "destination-version",
        "share",
        true,
      );
      try {
        const emit = (name: string) => media.dispatchEvent(new Event(name));
        // Native seeking events are queued after currentTime is restored.
        emit("seeking");
        media.seeking = false;
        emit("seeked");
        assert.deepEqual(
          events.map((e) => [e.kind, e.position]),
          [["version-changed", position]],
        );
        if (paused) {
          t.mock.timers.tick(2000);
          assert.equal(events.length, 1);
        }
        media.paused = false;
        emit("playing");
        emit("playing");
        assert.deepEqual(
          events.map((e) => [e.kind, e.position]),
          [
            ["version-changed", position],
            ["play", position],
          ],
        );
        now += 1000;
        media.currentTime = position + 1;
        emit("timeupdate");
        t.mock.timers.tick(2000);
        assert.deepEqual(
          events
            .filter((e) => e.kind === "interval")
            .map((e) => [e.position, e.end]),
          [[position, position + 1]],
        );
        media.currentTime = position + 10;
        media.seeking = true;
        emit("seeking");
        assert.deepEqual(
          events
            .filter((e) => e.kind === "seek")
            .map((e) => [e.position, e.end]),
          [[position + 1, position + 10]],
        );
      } finally {
        stop();
      }
    }
  }
});

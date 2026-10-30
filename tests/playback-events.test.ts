import { test } from "node:test";
import assert from "node:assert/strict";
import { observeListening } from "../app/components/listening";
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
}
test("visits and seeks do not count as plays; resume and repeat follow the agreed rules", async (t) => {
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
  const events: { kind: string; position: number; end?: number }[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: unknown, init: RequestInit) => {
      events.push(JSON.parse(String(init.body)));
      return new Response(null, { status: 204 });
    },
  );
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
    media.paused = false;
    emit("playing");
    move(1);
    move(2);
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
        (e) => e.kind === "interval" && e.position === 0 && e.end === 2,
      ),
    );
    assert.ok(
      events.some((e) => e.kind === "seek" && e.position === 2 && e.end === 0),
    );
  } finally {
    stop();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { observeListening } from "../app/components/listening";
import { recordVisit } from "../app/components/telemetry";
import { referrerWebsite } from "../app/domain/referrer";
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
test("delayed timers retain every second; player changes do not create visits; temporary failures retry the same event", async (t) => {
  const original = new Map(
    ["window", "document", "localStorage", "sessionStorage"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries({
    window: Object.assign(new EventTarget(), {
      location: { origin: "http://localhost" },
    }),
    document: { referrer: "https://example.org/private/path?token=secret" },
    localStorage: new Storage(),
    sessionStorage: new Storage(),
  }))
    Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  type Event = {
    id: string;
    kind: string;
    position: number;
    end?: number;
    referrer: string | null;
    session: string;
  };
  const requests: { url: string; body: Event }[] = [];
  let rejectNext = false;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    if (rejectNext) {
      rejectNext = false;
      return new Response(null, { status: 503 });
    }
    return new Response(null, { status: 204 });
  });
  t.mock.timers.enable({ apis: ["setInterval", "setTimeout"] });
  let now = 0;
  t.mock.method(performance, "now", () => now);
  recordVisit("link");
  assert.equal(requests[0].url, "/visits/link");
  assert.equal(requests[0].body.referrer, "https://example.org");
  const media = new Media();
  const stop = observeListening(
    media as unknown as HTMLAudioElement,
    "v1",
    "link",
  );
  media.paused = false;
  media.dispatchEvent(new globalThis.Event("playing"));
  now = 45000;
  media.currentTime = 45;
  media.dispatchEvent(new globalThis.Event("timeupdate"));
  rejectNext = true;
  media.paused = true;
  media.dispatchEvent(new globalThis.Event("pause"));
  const intervals = requests.filter((r) => r.body.kind === "interval");
  assert.deepEqual(
    intervals.map((r) => [r.body.position, r.body.end]),
    [
      [0, 30],
      [30, 45],
    ],
  );
  assert.ok(intervals.every((r) => r.body.end! - r.body.position <= 30));
  stop();
  const second = observeListening(
    new Media() as unknown as HTMLAudioElement,
    "v2",
    "link",
  );
  second();
  assert.equal(requests.filter((r) => r.body.kind === "visit").length, 1);
  assert.equal(requests.filter((r) => r.body.kind === "play").length, 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10000);
  assert.equal(
    requests.filter((r) => r.body.id === intervals[0].body.id).length,
    2,
  );
  assert.ok(requests.every((r) => r.body.session === requests[0].body.session));
});
test("referral attribution retains websites without leaking private URLs", () => {
  assert.equal(
    referrerWebsite(
      "https://example.org/private?token=secret#fragment",
      "https://wavecase.test",
    ),
    "https://example.org",
  );
  assert.equal(
    referrerWebsite("https://wavecase.test/s/secret", "https://wavecase.test"),
    null,
  );
  assert.equal(
    referrerWebsite("javascript:alert(1)", "https://wavecase.test"),
    null,
  );
  assert.equal(referrerWebsite(null, "https://wavecase.test"), null);
});

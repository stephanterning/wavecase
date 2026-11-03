import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { BufferedAudio } from "../app/components/buffered-audio";
import type { StreamManifest } from "../app/domain/audio-stream";

const manifest: StreamManifest = {
  revision: "a".repeat(64),
  frames: 48_000,
  channels: 1,
  sampleRate: 48_000,
  chunkFrames: 96_000,
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
class Node {
  port = {
    onmessage: null as null | ((event: { data: object }) => void),
    commands: [] as {
      type: string;
      playing?: boolean;
      generation?: number;
      frame?: number;
    }[],
    postMessage: (message: {
      type: string;
      playing?: boolean;
      generation?: number;
      frame?: number;
    }) => {
      this.port.commands.push(message);
      if (message.type === "seek")
        queueMicrotask(() =>
          this.port.onmessage?.({
            data: {
              generation: message.generation,
              frame: message.frame,
              playing: message.playing,
              waiting: false,
              ended: false,
              loops: 0,
              clock: 0,
            },
          }),
        );
    },
  };
  gain = {
    value: 1,
    setValueAtTime() {},
    cancelScheduledValues() {},
    linearRampToValueAtTime() {},
  };
  connect() {}
  disconnect() {}
}
function fixture(t: TestContext) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { href: "https://example.test/" } },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  });
  const context = {
    state: "running",
    currentTime: 0,
    createGain: () => new Node(),
    destination: {},
  } as unknown as AudioContext;
  const nodes: Node[] = [];
  const audio = new BufferedAudio(context, async () => {
    const node = new Node();
    nodes.push(node);
    return node as unknown as AudioWorkletNode;
  });
  t.after(() => audio.destroy());
  return { audio, nodes };
}

test("pause during initial transfer prevents a delayed automatic start", async (t) => {
  const { audio, nodes } = fixture(t);
  let finish: (() => void) | undefined;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("stream=manifest"))
      return Response.json(manifest);
    return new Promise<Response>((resolve) => {
      finish = () => resolve(new Response(new ArrayBuffer(48_000 * 4)));
    });
  });
  audio.src = "/audio";
  const play = audio.play();
  while (!finish) await tick();
  audio.pause();
  finish();
  await play;
  await tick();
  assert.equal(audio.paused, true);
  assert.equal(audio.readyState, 4);
  assert.ok(
    nodes[0].port.commands
      .filter((message) => message.type === "seek")
      .every((message) => !message.playing),
  );
});

test("replacing a pending transfer aborts it and a stale failure cannot poison the new source", async (t) => {
  const { audio, nodes } = fixture(t);
  let firstSignal: AbortSignal | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("stream=manifest"))
        return Response.json(manifest);
      if (String(input).includes("/first?")) {
        firstSignal = init!.signal!;
        return new Promise<Response>((_resolve, reject) =>
          firstSignal!.addEventListener(
            "abort",
            () => reject(firstSignal!.reason),
            { once: true },
          ),
        );
      }
      return new Response(new ArrayBuffer(48_000 * 4));
    },
  );
  audio.src = "/first";
  const first = audio.play();
  while (!firstSignal) await tick();
  audio.src = "/second";
  await audio.play();
  await first;
  await tick();
  assert.equal(firstSignal.aborted, true);
  assert.equal(audio.error, null);
  assert.equal(audio.paused, false);
  assert.equal(audio.readyState, 4);
  assert.ok(
    nodes[0].port.commands.some((message) => message.type === "dispose"),
  );
  assert.ok(
    nodes[1].port.commands.some(
      (message) => message.type === "seek" && message.playing,
    ),
  );
});

test("revoked or malformed parts fail closed and release the audio output", async (t) => {
  const { audio, nodes } = fixture(t);
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) =>
    String(input).includes("stream=manifest")
      ? Response.json(manifest)
      : new Response(null, { status: 404 }),
  );
  audio.src = "/audio";
  await assert.rejects(audio.play());
  await tick();
  assert.equal(audio.paused, true);
  assert.ok(audio.error);
  assert.ok(
    nodes[0].port.commands.some((message) => message.type === "dispose"),
  );
});

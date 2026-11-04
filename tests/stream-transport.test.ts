import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { compressedAudioCache } from "../app/components/compressed-audio-cache";
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
  t.after(() => {
    audio.destroy();
    compressedAudioCache.clear();
  });
  return { audio, nodes, context };
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

test("returning to a seek target starts a fresh transfer while its aborted fetch settles", async (t) => {
  const { audio } = fixture(t);
  let settle: (() => void) | undefined;
  let attempts = 0;
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const part = new URL(String(input)).searchParams.get("stream");
      if (part === "manifest")
        return Response.json({ ...manifest, frames: 120 * 48_000 });
      if (part === "20" && ++attempts === 1)
        return new Promise<Response>((_, reject) => {
          settle = () => reject(init!.signal!.reason);
        });
      return new Response(new ArrayBuffer(96_000 * 4));
    },
  );
  audio.src = "/audio";
  await tick();
  audio.currentTime = 40;
  await tick();
  audio.currentTime = 90;
  await tick();
  audio.currentTime = 40;
  await tick();
  settle!();
  await tick();
  assert.equal(attempts, 2);
  assert.equal(audio.seeking, false);
  assert.equal(audio.currentTime, 40);
  assert.equal(audio.error, null);
});

test("compressed reuse revalidates access, keeps decoder input intact and isolates grants and revisions", async (t) => {
  const { audio, context } = fixture(t);
  let revision = manifest.revision,
    denied = false;
  let gets = 0,
    heads = 0,
    decodes = 0;
  Object.assign(context, {
    decodeAudioData: async (bytes: ArrayBuffer) => {
      decodes++;
      assert.equal(bytes.byteLength, 1);
      structuredClone(bytes, { transfer: [bytes] });
      return {
        sampleRate: 48_000,
        numberOfChannels: 1,
        length: 48_000,
        getChannelData: () => new Float32Array(48_000),
      };
    },
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("stream=manifest"))
        return Response.json({
          ...manifest,
          revision,
          flacRate: 48_000,
          flacSamples: 48_000,
        });
      if (init?.method === "HEAD") {
        heads++;
        return new Response(null, { status: denied ? 404 : 200 });
      }
      gets++;
      return new Response(new Uint8Array([7]));
    },
  );
  const ready = async () => {
    for (let i = 0; i < 200 && !audio.error && audio.readyState < 4; i++)
      await tick();
    assert.equal(audio.readyState, 4);
    assert.equal(audio.error, null);
  };
  audio.src = "/audio?share=one";
  await ready();
  assert.equal(gets, 1);
  audio.load();
  await ready();
  assert.equal(gets, 1);
  assert.equal(heads, 1);
  assert.equal(decodes, 2);
  audio.src = "/audio?share=two";
  await ready();
  assert.equal(gets, 2);
  revision = "b".repeat(64);
  audio.src = "/audio?share=one";
  await ready();
  assert.equal(gets, 3);
  denied = true;
  audio.src = "https://example.test/audio?share=one";
  for (let i = 0; i < 200 && !audio.error; i++) await tick();
  assert.ok(audio.error);
  assert.equal(decodes, 4, "denied cached bytes are never decoded");
  assert.equal(
    compressedAudioCache.byteLength,
    1,
    "all cached revisions of the affected source are removed",
  );
});

test("uncompressed PCM never enters the compressed cache", async (t) => {
  const { audio } = fixture(t);
  let gets = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    if (String(input).includes("stream=manifest"))
      return Response.json(manifest);
    gets++;
    return new Response(new ArrayBuffer(48_000 * 4));
  });
  audio.src = "/pcm";
  for (let i = 0; i < 10 && audio.readyState < 4; i++) await tick();
  audio.load();
  for (let i = 0; i < 10 && audio.readyState < 4; i++) await tick();
  assert.equal(gets, 2);
  assert.equal(compressedAudioCache.byteLength, 0);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  playbackGainDb,
  playNormalized,
  disconnectPlaybackAudio,
  crossfadePlayback,
  seekPlayback,
  transitionSeconds,
} from "../app/components/playback-audio";

test("playback targets -16 LUFS with sample and true peak ceilings", () => {
  assert.equal(playbackGainDb({ lufs: -10, peak: -1, truePeak: -0.5 }), -6);
  assert.equal(playbackGainDb({ lufs: -24, peak: -12, truePeak: -10 }), 8);
  assert.equal(playbackGainDb({ lufs: -16, peak: -3, truePeak: -2 }), 0);
  assert.equal(playbackGainDb({ lufs: -24, peak: -3, truePeak: -4 }), 3);
  assert.equal(playbackGainDb({ lufs: -24, peak: -4, truePeak: -2 }), 1.99);
  assert.equal(playbackGainDb({ lufs: -24, peak: -1, truePeak: 1 }), -1.01);
  for (const metadata of [
    { lufs: -10, peak: -1, truePeak: -0.5 },
    { lufs: -24, peak: -3, truePeak: -4 },
    { lufs: -24, peak: -4, truePeak: -2 },
    { lufs: -24, peak: -1, truePeak: 1 },
  ]) {
    const gain = playbackGainDb(metadata);
    assert.ok(metadata.lufs + gain <= -16);
    assert.ok(metadata.peak + gain <= 0);
    assert.ok(metadata.truePeak + gain < 0);
  }
});

test("silence and missing or non-finite measurements never cause unsafe gain", () => {
  for (const metadata of [
    null,
    {},
    { lufs: null, peak: null, truePeak: null },
    { lufs: -Infinity, peak: -Infinity, truePeak: -Infinity },
    { lufs: NaN, peak: -8, truePeak: -6 },
    { lufs: -30, peak: null, truePeak: -6 },
    { lufs: -30, peak: -8, truePeak: undefined },
    { lufs: "-30", peak: -8, truePeak: -6 },
  ])
    assert.equal(playbackGainDb(metadata), 0);
  assert.equal(playbackGainDb({ lufs: -10 }), -6);
  assert.equal(playbackGainDb({ lufs: null, peak: -1, truePeak: 2 }), -2.01);
});

test("playback applies gain before playing, reuses sources, and resumes the context for every entry point", async (t) => {
  class Node {
    connections: Node[] = [];
    connect(destination: Node) {
      this.connections.push(destination);
    }
    disconnect() {
      this.connections = [];
    }
  }
  const gains: number[] = [];
  const sources: Node[] = [];
  const envelopes: {
    value: number;
    ramps: [number, number][];
    cancelScheduledValues: () => void;
    setValueAtTime: (value: number) => void;
    linearRampToValueAtTime: (value: number, time: number) => void;
  }[] = [];
  let nodes = 0;
  let contexts = 0;
  let resumes = 0;
  let rejectResume = false;
  const instances: Context[] = [];
  class Context {
    state = "suspended";
    currentTime = 0;
    destination = new Node();
    constructor() {
      contexts++;
      instances.push(this);
    }
    createMediaElementSource() {
      const source = new Node();
      sources.push(source);
      return source;
    }
    createGain() {
      const envelope = nodes++ % 2 === 1;
      const param = {
        value: 1,
        ramps: [] as [number, number][],
        cancelScheduledValues() {},
        setValueAtTime(value: number) {
          this.value = value;
          if (!envelope) gains.push(value);
        },
        linearRampToValueAtTime(value: number, time: number) {
          this.value = value;
          this.ramps.push([value, time]);
        },
      };
      if (envelope) envelopes.push(param);
      return Object.assign(new Node(), {
        gain: param,
      });
    }
    async resume() {
      resumes++;
      if (rejectResume) throw new Error("Context interrupted");
      this.state = "running";
    }
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: Context,
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "AudioContext", previous);
    else Reflect.deleteProperty(globalThis, "AudioContext");
  });
  let playing = false;
  let rejectPlay = false;
  const media = {
    async play() {
      assert.ok(gains.length > 0, "gain is set before playback starts");
      assert.equal(sources[0].connections.length, 1);
      if (rejectPlay) throw new Error("Playback denied");
      playing = true;
    },
    pause() {
      playing = false;
    },
  } as unknown as HTMLAudioElement;
  await playNormalized(media, 6);
  assert.ok(playing);
  assert.equal(gains.at(-1), 10 ** (6 / 20));
  assert.equal(resumes, 1);
  await playNormalized(media, -6);
  assert.equal(gains.at(-1), 10 ** (-6 / 20));
  assert.equal(sources.length, 1);
  assert.equal(sources[0].connections.length, 1);
  disconnectPlaybackAudio(media);
  assert.equal(sources[0].connections.length, 0);
  await playNormalized(media, 0);
  assert.equal(
    sources.length,
    1,
    "effect reconnect does not recreate a media source",
  );
  assert.equal(sources[0].connections.length, 1);
  const next = {
    play: async () => {},
    pause: () => {},
  } as unknown as HTMLAudioElement;
  await playNormalized(next, 3);
  assert.equal(contexts, 1, "version changes reuse the unlocked context");
  assert.equal(sources.length, 2);
  await playNormalized(next, 3, true);
  assert.equal(envelopes[1].value, 0, "preparing another version is inaudible");
  assert.equal(
    next.muted,
    true,
    "the native platform also sees the candidate as muted",
  );
  crossfadePlayback(media, next);
  assert.equal(next.muted, false);
  assert.deepEqual(envelopes[0].ramps.at(-1), [0, transitionSeconds]);
  assert.deepEqual(envelopes[1].ramps.at(-1), [1, transitionSeconds]);
  assert.ok(transitionSeconds <= 0.005);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const seekMedia = Object.assign(new EventTarget(), {
    currentTime: 10,
    duration: 60,
    seeking: true,
    paused: false,
    play: async () => {},
    pause: () => {},
  });
  const seekAudio = seekMedia as unknown as HTMLAudioElement;
  await playNormalized(seekAudio, 0);
  let completed = 0;
  seekMedia.addEventListener("wavecase-user-seeked", () => completed++);
  seekPlayback(seekAudio, 40);
  seekMedia.seeking = false;
  seekMedia.dispatchEvent(new Event("seeked"));
  assert.equal(completed, 0, "an old seek cannot finish a pending new seek");
  t.mock.timers.tick(transitionSeconds * 1000);
  assert.equal(
    seekMedia.currentTime,
    40,
    "the latest seek survives the old event",
  );
  assert.equal(completed, 1);
  disconnectPlaybackAudio(seekAudio);
  t.mock.timers.reset();
  instances[0].state = "suspended";
  await playNormalized(media, 0);
  assert.equal(resumes, 2);
  rejectPlay = true;
  await assert.rejects(playNormalized(media, 0), /Playback denied/);
  assert.equal(playing, false);
  rejectPlay = false;
  instances[0].state = "suspended";
  rejectResume = true;
  await assert.rejects(playNormalized(media, 0), /Context interrupted/);
  assert.equal(
    playing,
    false,
    "context failure must not leave silent playback running",
  );
  rejectResume = false;
  let rejectOld!: (error: Error) => void;
  const oldPlay = new Promise<void>((_, reject) => {
    rejectOld = reject;
  });
  let calls = 0;
  t.mock.method(media, "play", () => {
    playing = true;
    return ++calls === 1 ? oldPlay : Promise.resolve();
  });
  const interrupted = playNormalized(media, -3);
  await playNormalized(media, -6);
  rejectOld(new Error("Source replaced"));
  await assert.rejects(interrupted, /Source replaced/);
  assert.equal(
    playing,
    true,
    "an old play rejection must not pause a new source",
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });
  t.mock.method(media, "play", () => new Promise<void>(() => {}));
  const pending = playNormalized(media, 0);
  const timedOut = assert.rejects(pending, /startup timed out/);
  t.mock.timers.tick(30000);
  await timedOut;
  assert.equal(playing, false, "a stalled native start reaches retry");
  t.mock.timers.reset();
  disconnectPlaybackAudio(media);
  disconnectPlaybackAudio(next);
});

test("rapid seeks keep only the latest position and do not count as native loops", () => {
  const fake = Object.assign(new EventTarget(), {
    currentTime: 1,
    duration: 60,
    seeking: true,
    paused: false,
  });
  const media = fake as unknown as HTMLAudioElement;
  let completed = 0;
  media.addEventListener("wavecase-user-seeked", () => completed++);
  seekPlayback(media, 20);
  seekPlayback(media, 40);
  assert.equal(media.currentTime, 40);
  fake.seeking = false;
  media.dispatchEvent(new Event("seeked"));
  assert.equal(completed, 1);
});

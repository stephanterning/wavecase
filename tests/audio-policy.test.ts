import { test } from "node:test";
import assert from "node:assert/strict";
import { playbackPlan } from "../app/server/audio-policy";
test("higher resolution is reduced without upsampling a low sample rate", () => {
  assert.deepEqual(playbackPlan("pcm_s24le", 96000, 24, "wav"), {
    keepOriginal: false,
    mime: "audio/wav",
    sampleRate: 48000,
    codec: "pcm_s24le",
    wavDownload: true,
    dither: false,
  });
  assert.equal(playbackPlan("pcm_s24le", 22050, 24, "wav").sampleRate, 22050);
});
test("lower quality compatible originals are preserved", () => {
  assert.equal(playbackPlan("mp3", 32000, 0, "mp3").keepOriginal, true);
  assert.equal(playbackPlan("pcm_u8", 22050, 8, "wav").keepOriginal, true);
  assert.equal(playbackPlan("flac", 32000, 16, "flac").keepOriginal, false);
});
test("invalid rates fail clearly", () =>
  assert.throws(() => playbackPlan("aac", NaN, 0, "aac")));
import { sameDuration } from "../app/server/audio";
test("replacement duration compares exact sample ratios, not rounded seconds", () => {
  assert.equal(
    sameDuration(
      { samples: 44100, sampleRate: 44100 },
      { samples: 48000, sampleRate: 48000 },
    ),
    true,
  );
  assert.equal(
    sameDuration(
      { samples: 44101, sampleRate: 44100 },
      { samples: 48000, sampleRate: 48000 },
    ),
    false,
  );
});

test("target-quality lossless compressed input is decoded to uncompressed playback", () =>
  assert.equal(playbackPlan("flac", 44100, 16, "flac").keepOriginal, false));

test("direct playback requires a compatible container as well as codec", () => {
  assert.equal(playbackPlan("pcm_s16le", 44100, 16, "caf").keepOriginal, false);
  assert.equal(
    playbackPlan("aac", 32000, 0, "matroska,webm").keepOriginal,
    false,
  );
  assert.equal(
    playbackPlan("aac", 32000, 0, "mov,mp4,m4a,3gp,3g2,mj2").mime,
    "audio/mp4",
  );
  assert.equal(playbackPlan("vorbis", 32000, 0, "ogg").mime, "audio/ogg");
});

test("the ceiling limits each property independently and dithers only reductions above 24 bits", () => {
  for (const [codec, rate, depth, outputRate, outputCodec, dither] of [
    ["pcm_s32le", 96000, 32, 48000, "pcm_s24le", true],
    ["pcm_f32le", 44100, 32, 44100, "pcm_s24le", true],
    ["pcm_s16le", 96000, 16, 48000, "pcm_s16le", false],
    ["pcm_s16le", 44100, 16, 44100, "pcm_s16le", false],
  ] as const) {
    const plan = playbackPlan(codec, rate, depth, "wav");
    assert.equal(plan.sampleRate, outputRate);
    assert.equal(plan.codec, outputCodec);
    assert.equal(plan.dither, dither);
  }
});

test("WAV downloads depend on lossless codec, not container or decoded sample format", () => {
  for (const codec of ["pcm_s24be", "pcm_f32le", "flac", "alac", "ape"])
    assert.equal(playbackPlan(codec, 48000, 24, "aiff").wavDownload, true);
  for (const codec of ["aac", "mp3", "opus", "pcm_mulaw", "adpcm_ima_wav"])
    assert.equal(playbackPlan(codec, 48000, 0, "wav").wavDownload, false);
});

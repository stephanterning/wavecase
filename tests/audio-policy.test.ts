import { test } from "node:test";
import assert from "node:assert/strict";
import { playbackPlan } from "../app/server/audio-policy";
test("higher resolution is reduced without upsampling a low sample rate", () => {
  assert.deepEqual(playbackPlan("pcm_s24le", 96000, 24, "wav"), {
    keepOriginal: false,
    mime: "audio/wav",
    sampleRate: 44100,
    codec: "pcm_s16le",
  });
  assert.equal(playbackPlan("pcm_s24le", 22050, 24, "wav").sampleRate, 22050);
});
test("lower quality compatible originals are preserved", () => {
  assert.equal(playbackPlan("mp3", 32000, 0, "mp3").keepOriginal, true);
  assert.equal(playbackPlan("pcm_u8", 22050, 8, "wav").keepOriginal, true);
  assert.equal(playbackPlan("flac", 32000, 16, "flac").keepOriginal, true);
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

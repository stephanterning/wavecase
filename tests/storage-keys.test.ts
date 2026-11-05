import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { processAudio } from "../app/server/audio";
import { encodeFlac, encodeMp3, encodeWav } from "../app/server/audio-exports";
import { removeAudioFiles } from "../app/server/audio-files";
import { processReleaseAudio } from "../app/server/release-audio";
import {
  decodedPlayback,
  decodedSource,
  derivedFiles,
  exportTemporary,
  flacPart,
  lossless,
  mp3,
  playbackWav,
  streamFile,
  temporary,
} from "../app/server/storage-keys";
const exec = promisify(execFile);

test("removal covers every file produced for a demo and a release upload", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-storage-"));
  try {
    for (const [key, codec, rate] of [
      ["demo", "pcm_f32le", 96000],
      ["release", "pcm_s24le", 44100],
      ["other", "pcm_s16le", 44100],
    ] as const)
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        `sine=duration=0.5:sample_rate=${rate}`,
        "-c:a",
        codec,
        "-f",
        "wav",
        join(directory, key),
      ]);
    const demo = await processAudio(directory, "demo");
    assert.equal(demo.playback, "demo.wav");
    await encodeMp3(directory, "demo");
    await encodeWav(directory, "demo");
    await encodeFlac(directory, "demo");
    const release = await processReleaseAudio(directory, "release");
    await encodeMp3(directory, "other");
    // Leftovers of processing, stream preparation and exports that crashed.
    const interrupted = [
      decodedSource("demo"),
      decodedPlayback("demo"),
      flacPart(demo.playback),
      ...(["json", "pcm", "flac"] as const).map((kind) =>
        temporary(streamFile(demo.playback, kind)),
      ),
      ...[mp3("demo"), lossless("demo", "wav"), lossless("demo", "flac")].map(
        exportTemporary,
      ),
      exportTemporary(mp3("release")),
    ];
    const kept = [exportTemporary(mp3("other")), "demo.unrelated.tmp"];
    for (const name of [...interrupted, ...kept])
      await writeFile(join(directory, name), "partial");

    await removeAudioFiles(directory, [
      demo.original,
      demo.playback,
      "release",
      release.playback,
    ]);
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["other", mp3("other"), ...kept].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("removing a playback key keeps its original and the original's exports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-storage-"));
  try {
    const files = ["k", mp3("k"), playbackWav("k"), streamFile("k", "json")];
    for (const name of files) await writeFile(join(directory, name), "audio");
    await removeAudioFiles(directory, [playbackWav("k")]);
    assert.deepEqual(
      (await readdir(directory)).sort(),
      ["k", mp3("k"), streamFile("k", "json")].sort(),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("names already on disk are still removed", () => {
  const derived = new Set(derivedFiles("k"));
  for (const name of [
    "k.wav",
    "k.m4a",
    "k.mp3",
    "k.mp3.tmp",
    "k.export.wav",
    "k.export.wav.tmp",
    "k.16-44100.wav",
    "k.16-44100.wav.tmp",
    "k.16-44100.flac",
    "k.16-44100.flac.tmp",
    ...["k", "k.wav", "k.mp3"].flatMap((base) =>
      [".pcm", ".json", ".flac"]
        .flatMap((suffix) => [suffix, suffix + ".tmp"])
        .concat(".part.tmp")
        .map((suffix) => base + ".stream-v1" + suffix),
    ),
  ])
    assert.ok(derived.has(name), name);
});

// Artwork and attachment names are not derived from audio keys; rows store them.
test("only the storage key module builds derived file names", async () => {
  const suffix = String.raw`\.(?!(?:png|jpg|zip|m3u8)\b)[\w-]`;
  const derivedName = new RegExp(
    String.raw`(?<!endsWith\()["'\x60]${suffix}|\}${suffix}`,
  );
  const sources = (await readdir("app", { recursive: true })).filter(
    (file) =>
      file.endsWith(".ts") &&
      file !== join("server", "storage-keys.ts") &&
      // HLS uses fixed asset names inside an opaque capability directory;
      // its only upload-derived name (the mapping) still lives in storage-keys.
      file !== join("server", "hls.ts"),
  );
  assert.ok(sources.includes(join("server", "audio-stream.ts")));
  for (const file of sources) {
    const lines = (await readFile(join("app", file), "utf8")).split("\n");
    lines.forEach((line, index) =>
      assert.doesNotMatch(line, derivedName, `app/${file}:${index + 1}`),
    );
  }
});

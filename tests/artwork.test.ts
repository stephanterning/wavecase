import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webArtwork } from "../app/server/artwork";
import { removeAudioFiles } from "../app/server/audio-files";
import { artworkFile } from "../app/server/storage-keys";

const exec = promisify(execFile);

test("web artwork is smaller, bounded, cached and removed with its unchanged source", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-artwork-"));
  try {
    const source = join(directory, "cover.png");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=2000x1500",
      "-frames:v",
      "1",
      "-compression_level",
      "0",
      source,
    ]);
    const original = await readFile(source);
    const images = await Promise.all([
      webArtwork(directory, "cover.png"),
      webArtwork(directory, "cover.png"),
    ]);
    assert.deepEqual(images[0], images[1]);
    assert.ok(images[0].length < original.length / 10);
    const cached = join(directory, artworkFile("cover.png", "web"));
    const before = await stat(cached);
    assert.deepEqual(await webArtwork(directory, "cover.png"), images[0]);
    assert.equal((await stat(cached)).mtimeMs, before.mtimeMs);
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      cached,
    ]);
    const image = JSON.parse(stdout).streams[0];
    assert.equal(image.codec_name, "webp");
    assert.equal(image.width, 1000);
    assert.equal(image.height, 750);
    const square = await webArtwork(directory, "cover.png", "media");
    assert.ok(square.length > 0);
    assert.deepEqual(await readFile(source), original);
    await removeAudioFiles(directory, ["cover.png"]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("small images keep their dimensions and a failed conversion can be retried", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-artwork-"));
  try {
    const source = join(directory, "small.png");
    await writeFile(source, "invalid image");
    await assert.rejects(webArtwork(directory, "small.png"));
    assert.deepEqual(await readdir(directory), ["small.png"]);
    await exec("ffmpeg", [
      "-v",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=size=80x40",
      "-frames:v",
      "1",
      source,
    ]);
    await webArtwork(directory, "small.png");
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      join(directory, artworkFile("small.png", "web")),
    ]);
    const image = JSON.parse(stdout).streams[0];
    assert.equal(image.width, 80);
    assert.equal(image.height, 40);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

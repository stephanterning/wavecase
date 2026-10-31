import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../app/server/db";
import { mp3Download } from "../app/server/download";
import {
  users,
  tracks,
  versions,
  links,
  comments,
  artists,
  releases,
  releaseTracks,
} from "../app/server/schema";
import { processReleaseAudio } from "../app/server/release-audio";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
const queueModule = enabled ? await import("../app/server/queue") : null;
after(async () => {
  if (queueModule) await queueModule.boss.stop();
  await pool.end();
});
async function waitFor(id: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const version = await db.query.versions.findFirst({
      where: eq(versions.id, id),
    });
    if (version && !version.pendingOriginal) return version;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Worker did not finish processing");
}
test(
  "durable worker preserves valid audio and recovers queued replacement after restart",
  { skip: !enabled, timeout: 45000 },
  async () => {
    const { queue, boss } = queueModule!;
    const directory = await mkdtemp(join(tmpdir(), "wavecase-worker-"));
    let child: ReturnType<typeof spawn> | undefined;
    try {
      const owner = randomUUID(),
        track = randomUUID(),
        version = randomUUID(),
        link = randomUUID();
      await db.insert(users).values({
        id: owner,
        name: "Audio owner",
        email: owner + "@test.invalid",
      });
      await db
        .insert(tracks)
        .values({ id: track, ownerId: owner, title: "Worker test" });
      await db
        .insert(links)
        .values({ id: link, trackId: track, label: "Feedback" });
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=3:sample_rate=96000",
        "-c:a",
        "pcm_s32le",
        join(directory, "original.wav"),
      ]);
      await db.insert(versions).values({
        id: version,
        trackId: track,
        name: "v1",
        filename: "original.wav",
        pendingOriginal: "original.wav",
        pendingFilename: "original.wav",
      });
      const artist = randomUUID(),
        release = randomUUID(),
        releaseTrack = randomUUID();
      await db
        .insert(artists)
        .values({
          id: artist,
          ownerId: owner,
          name: "Worker artist",
          slug: artist,
        });
      await db
        .insert(releases)
        .values({
          id: release,
          artistId: artist,
          title: "Legacy release",
          slug: release,
        });
      const releaseResult = await processReleaseAudio(
        directory,
        "original.wav",
      );
      const releaseBytes = await readFile(
        join(directory, releaseResult.playback),
      );
      await db.insert(releaseTracks).values({
        id: releaseTrack,
        releaseId: release,
        title: "Existing audio",
        position: 1,
        original: "original.wav",
        ...releaseResult,
        audioMeasurements: null,
      });
      await queue();
      async function startWorker() {
        child = spawn(
          process.execPath,
          ["--import", "tsx", "app/server/worker.ts"],
          {
            env: { ...process.env, DATA_DIR: directory },
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        await new Promise<void>((resolve, reject) => {
          child!.once("error", reject);
          child!.once("exit", (code) =>
            reject(new Error("Worker exited: " + code)),
          );
          child!.stdout!.on("data", (data) => {
            if (String(data).includes("worker ready")) resolve();
          });
        });
      }
      await startWorker();
      const initial = await waitFor(version);
      let measured;
      for (let attempt = 0; attempt < 100; attempt++) {
        measured = await db.query.releaseTracks.findFirst({
          where: eq(releaseTracks.id, releaseTrack),
        });
        if (measured?.audioMeasurements) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.deepEqual(
        measured?.audioMeasurements,
        releaseResult.audioMeasurements,
      );
      assert.equal(measured?.playback, releaseResult.playback);
      assert.deepEqual(
        await readFile(join(directory, releaseResult.playback)),
        releaseBytes,
      );
      assert.equal(initial.state, "ready");
      assert.equal(initial.duration, 3);
      assert.equal(initial.original, initial.playback);
      assert.equal(initial.filename, "original.wav");
      assert.equal(initial.metadata?.sampleRate, 96000);
      async function removed(key: string) {
        for (let i = 0; i < 50; i++) {
          try {
            await stat(join(directory, key));
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
            throw e;
          }
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.fail("File was not removed: " + key);
      }
      await removed("original.wav");
      const cached = await mp3Download(version, initial.original!, directory);
      const originalBytes = await readFile(join(directory, initial.playback!));
      await db.insert(comments).values({
        versionId: version,
        linkId: link,
        name: "Listener",
        body: "Keep this timing",
        start: 1,
      });
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=2:sample_rate=48000",
        "-c:a",
        "pcm_s24le",
        join(directory, "short.wav"),
      ]);
      await db
        .update(versions)
        .set({ pendingOriginal: "short.wav", pendingFilename: "short.wav" })
        .where(eq(versions.id, version));
      await boss.send(
        "process-audio",
        { versionId: version },
        { singletonKey: version },
      );
      const rejected = await waitFor(version);
      assert.equal(rejected.state, "ready");
      assert.match(rejected.error!, /exactly the same duration/);
      assert.deepEqual(
        await readFile(join(directory, rejected.playback!)),
        originalBytes,
      );
      // Failed conversion must preserve the active master and its cached export.
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "aevalsrc=1.25:s=48000:d=3",
        "-c:a",
        "pcm_f32le",
        join(directory, "over.wav"),
      ]);
      await db
        .update(versions)
        .set({ pendingOriginal: "over.wav", pendingFilename: "over.wav" })
        .where(eq(versions.id, version));
      await boss.send(
        "process-audio",
        { versionId: version },
        { singletonKey: version },
      );
      const overRange = await waitFor(version);
      assert.equal(overRange.state, "ready");
      assert.match(overRange.error!, /Audio exceeds the PCM range/);
      assert.equal(overRange.original, initial.original);
      assert.deepEqual(
        await readFile(join(directory, overRange.original!)),
        originalBytes,
      );
      assert.ok((await stat(join(directory, cached))).size > 0);
      await removed("over.wav");
      // Persist a replacement while the worker is down, then recover it after restart.
      const stopped = new Promise((resolve) => child!.once("exit", resolve));
      child!.kill("SIGTERM");
      await stopped;
      await writeFile(join(directory, "replacement.wav"), originalBytes);
      await db
        .update(versions)
        .set({
          pendingOriginal: "replacement.wav",
          pendingFilename: "replacement.wav",
        })
        .where(eq(versions.id, version));
      await boss.send(
        "process-audio",
        { versionId: version },
        { singletonKey: version },
      );
      await startWorker();
      const replaced = await waitFor(version);
      assert.equal(replaced.error, null);
      assert.equal(replaced.original, "replacement.wav");
      assert.equal(replaced.position, initial.position);
      assert.equal(replaced.original, replaced.playback);
      await removed(initial.original!);
      await removed(cached);
      await removed("short.wav");
      assert.equal(
        (
          await db.query.versions.findMany({
            where: eq(versions.trackId, track),
          })
        ).length,
        1,
      );
    } finally {
      if (child && !child.killed) {
        const closed = new Promise((resolve) => child!.once("exit", resolve));
        child.kill("SIGTERM");
        await closed;
      }
      await rm(directory, { recursive: true, force: true });
    }
  },
);

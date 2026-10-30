import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../app/server/db";
import { users, tracks, versions, links, comments } from "../app/server/schema";
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
        "sine=duration=3:sample_rate=48000",
        "-c:a",
        "pcm_s24le",
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
      assert.equal(initial.state, "ready");
      assert.equal(initial.duration, 3);
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
      // Persist a replacement while the worker is down, then recover it after restart.
      const stopped = new Promise((resolve) => child!.once("exit", resolve));
      child!.kill("SIGTERM");
      await stopped;
      await writeFile(
        join(directory, "replacement.wav"),
        await readFile(join(directory, "original.wav")),
      );
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

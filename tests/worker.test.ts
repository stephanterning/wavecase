import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "../app/server/db";
import { demoAudioDownload } from "../app/server/download";
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
import {
  InvalidAudioError,
  invalidAudio,
  retryProcessing,
} from "../app/server/processing-errors";
import { enabled } from "./database";
const queueModule = enabled ? await import("../app/server/queue") : null;
after(async () => {
  if (queueModule) await queueModule.boss.stop();
  await pool.end();
});
async function waitFor(id: string) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const version = await db.query.versions.findFirst({
      where: eq(versions.id, id),
    });
    if (version && !version.pendingOriginal) return version;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Worker did not finish processing");
}
async function spawnWorker(directory: string) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "app/server/worker.ts"],
    {
      env: { ...process.env, DATA_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error("Worker exited: " + code)));
    child.stdout!.on("data", (data) => {
      if (String(data).includes("worker ready")) resolve();
    });
  });
  return child;
}
async function stopWorker(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await closed;
}
async function exists(path: string) {
  return stat(path).then(
    () => true,
    (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    },
  );
}
test("only rejections of the upload itself are permanent", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-errors-"));
  const failure = (command: string, args: string[], timeout = 0) =>
    promisify(execFile)(command, args, { timeout }).then(
      () => assert.fail(command + " succeeded"),
      (error: unknown) => error,
    );
  try {
    await writeFile(join(directory, "invalid.wav"), "not audio".repeat(100));
    const sine = [
      "-nostdin",
      "-y",
      "-xerror",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
    ];
    const invalid = await failure("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      join(directory, "invalid.wav"),
    ]);
    const diskFull = await failure("ffmpeg", [
      ...sine,
      "sine=duration=1",
      "-f",
      "wav",
      "/dev/full",
    ]);
    const timedOut = await failure(
      "ffmpeg",
      [...sine, "sine=duration=600", "-f", "null", "-"],
      50,
    );
    assert.equal(invalidAudio(invalid), true);
    assert.equal(invalidAudio(new InvalidAudioError("Audio is empty.")), true);
    assert.equal(invalidAudio(diskFull), false);
    assert.equal(invalidAudio(timedOut), false);
    assert.equal(
      invalidAudio(
        Object.assign(new Error("deadlock detected"), { code: "40P01" }),
      ),
      false,
    );
    assert.equal(retryProcessing(timedOut, { retryCount: 2 }), true);
    assert.equal(retryProcessing(timedOut, { retryCount: 3 }), false);
    assert.equal(retryProcessing(invalid, { retryCount: 0 }), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
test(
  "worker keeps pending uploads through transient failures and fails visibly after the last retry",
  { skip: !enabled, timeout: 90000 },
  async () => {
    const { queue, boss } = queueModule!;
    const directory = await mkdtemp(join(tmpdir(), "wavecase-retry-"));
    const owner = randomUUID(),
      track = randomUUID(),
      transient = randomUUID(),
      exhausted = randomUUID(),
      invalid = randomUUID(),
      artist = randomUUID(),
      release = randomUUID(),
      releaseTrack = randomUUID();
    // Publication updates are rejected like a serialization failure; the
    // final failure update leaves state and original unchanged and passes.
    const blocked = [
      ["versions", transient, "new.state = 'ready'"],
      ["versions", exhausted, "new.state = 'ready'"],
      [
        "release_tracks",
        releaseTrack,
        "new.original is distinct from old.original",
      ],
    ];
    await db.execute(
      sql.raw(`create or replace function wavecase_test_block_publication()
        returns trigger language plpgsql as $$ begin
          raise exception 'simulated publication failure' using errcode = '40001';
        end $$`),
    );
    for (const [table, id, condition] of blocked)
      await db.execute(
        sql.raw(`create trigger "block_${id}" before update on ${table}
          for each row when (new.id = '${id}' and ${condition})
          execute function wavecase_test_block_publication()`),
      );
    const unblock = (table: string, id: string) =>
      db.execute(sql.raw(`drop trigger if exists "block_${id}" on ${table}`));
    await queue();
    const child = await spawnWorker(directory);
    try {
      await db.insert(users).values({
        id: owner,
        name: "Retry owner",
        email: owner + "@test.invalid",
      });
      await db
        .insert(tracks)
        .values({ id: track, ownerId: owner, title: "Retry test" });
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=1:sample_rate=48000",
        "-c:a",
        "pcm_s24le",
        join(directory, "transient.wav"),
      ]);
      await writeFile(
        join(directory, "exhausted.wav"),
        await readFile(join(directory, "transient.wav")),
      );
      await writeFile(
        join(directory, "release.wav"),
        await readFile(join(directory, "transient.wav")),
      );
      await writeFile(join(directory, "invalid.wav"), "not audio".repeat(100));
      for (const [id, key] of [
        [transient, "transient.wav"],
        [exhausted, "exhausted.wav"],
        [invalid, "invalid.wav"],
      ])
        await db.insert(versions).values({
          id,
          trackId: track,
          name: key,
          filename: key,
          pendingOriginal: key,
          pendingFilename: key,
        });
      const enqueue = async (id: string, name = "process-audio") => {
        const job = await boss.send(
          name,
          name === "process-audio" ? { versionId: id } : { trackId: id },
          { singletonKey: id, retryLimit: 3, retryDelay: 1 },
        );
        return () => boss.getJobById(name, job!);
      };
      const transientJob = await enqueue(transient);
      for (let attempt = 0; (await transientJob())!.retryCount < 1; attempt++) {
        if (attempt > 200) assert.fail("Publication failure was not retried");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const retrying = await db.query.versions.findFirst({
        where: eq(versions.id, transient),
      });
      assert.equal(retrying?.state, "processing");
      assert.equal(retrying?.pendingOriginal, "transient.wav");
      assert.equal(retrying?.error, null);
      assert.ok(await exists(join(directory, "transient.wav")));
      await unblock("versions", transient);
      const recovered = await waitFor(transient);
      assert.equal(recovered.state, "ready");
      assert.equal(recovered.original, "transient.wav");
      assert.equal(recovered.error, null);

      const exhaustedJob = await enqueue(exhausted);
      const failed = await waitFor(exhausted);
      assert.equal((await exhaustedJob())?.retryCount, 3);
      assert.equal(failed.state, "failed");
      assert.match(failed.error!, /^Audio could not be processed/);
      assert.equal(failed.pendingFilename, null);
      assert.equal(await exists(join(directory, "exhausted.wav")), false);

      const invalidJob = await enqueue(invalid);
      const rejected = await waitFor(invalid);
      assert.equal((await invalidJob())?.retryCount, 0);
      assert.equal(rejected.state, "failed");
      assert.match(rejected.error!, /^Audio could not be processed/);
      assert.equal(await exists(join(directory, "invalid.wav")), false);

      await db.insert(artists).values({
        id: artist,
        ownerId: owner,
        name: "Retry artist",
        slug: artist,
      });
      await db.insert(releases).values({
        id: release,
        artistId: artist,
        title: "Retry",
        slug: release,
      });
      await db.insert(releaseTracks).values({
        id: releaseTrack,
        releaseId: release,
        title: "Retry master",
        position: 1,
        pendingOriginal: "release.wav",
      });
      const releaseJob = await enqueue(releaseTrack, "process-release");
      let releaseFailed;
      for (let attempt = 0; attempt < 300; attempt++) {
        releaseFailed = await db.query.releaseTracks.findFirst({
          where: eq(releaseTracks.id, releaseTrack),
        });
        if (!releaseFailed?.pendingOriginal) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(releaseFailed?.pendingOriginal, null);
      assert.equal((await releaseJob())?.retryCount, 3);
      assert.equal(releaseFailed?.original, null);
      assert.match(releaseFailed!.error!, /^Could not process this file/);
      assert.equal(await exists(join(directory, "release.wav")), false);
    } finally {
      await stopWorker(child);
      await db.execute(
        sql`drop function if exists wavecase_test_block_publication() cascade`,
      );
      await rm(directory, { recursive: true, force: true });
    }
  },
);
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
        pendingUploadedAt: new Date("2026-10-30T09:00:00Z"),
      });
      const artist = randomUUID(),
        release = randomUUID(),
        releaseTrack = randomUUID();
      await db.insert(artists).values({
        id: artist,
        ownerId: owner,
        name: "Worker artist",
        slug: artist,
      });
      await db.insert(releases).values({
        id: release,
        artistId: artist,
        title: "Legacy release",
        slug: release,
      });
      const uploadedBytes = await readFile(join(directory, "original.wav"));
      await writeFile(join(directory, "release-master.wav"), uploadedBytes);
      const releaseResult = await processReleaseAudio(
        directory,
        "release-master.wav",
      );
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-i",
        join(directory, "release-master.wav"),
        "-c:a",
        "aac",
        "-b:a",
        "256k",
        join(directory, "legacy.m4a"),
      ]);
      const releaseBytes = await readFile(
        join(directory, releaseResult.playback),
      );
      // Force migration to encode from the WAV master, not reuse a cache or
      // transcode the lossy AAC. Its bytes must match the direct WAV encode.
      await unlink(join(directory, releaseResult.playback));
      await db.insert(releaseTracks).values({
        id: releaseTrack,
        releaseId: release,
        title: "Existing audio",
        position: 1,
        original: "release-master.wav",
        ...releaseResult,
        playback: "legacy.m4a",
        audioMeasurements: releaseResult.audioMeasurements,
      });
      await queue();
      child = await spawnWorker(directory);
      const initial = await waitFor(version);
      let measured;
      for (let attempt = 0; attempt < 100; attempt++) {
        measured = await db.query.releaseTracks.findFirst({
          where: eq(releaseTracks.id, releaseTrack),
        });
        if (measured?.playback === releaseResult.playback) break;
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
      assert.equal(initial.original, "original.wav");
      assert.notEqual(initial.original, initial.playback);
      assert.equal(initial.filename, "original.wav");
      assert.equal(initial.metadata?.sampleRate, 96000);
      assert.equal(
        initial.uploadedAt?.toISOString(),
        "2026-10-30T09:00:00.000Z",
      );
      assert.equal(initial.pendingUploadedAt, null);
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
      await removed("legacy.m4a");
      assert.deepEqual(
        await readFile(join(directory, "original.wav")),
        uploadedBytes,
      );
      const cached = await demoAudioDownload(
        version,
        initial.original!,
        directory,
        "mp3",
      );
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
        .set({
          pendingOriginal: "short.wav",
          pendingFilename: "short.wav",
          pendingUploadedAt: new Date("2026-11-01T10:00:00Z"),
        })
        .where(eq(versions.id, version));
      await boss.send(
        "process-audio",
        { versionId: version },
        { singletonKey: version },
      );
      const rejected = await waitFor(version);
      assert.equal(rejected.state, "ready");
      assert.match(
        rejected.error!,
        /exactly the same duration .* Current: 0:03, replacement: 0:02\.$/,
      );
      assert.deepEqual(rejected.uploadedAt, initial.uploadedAt);
      assert.equal(rejected.pendingUploadedAt, null);
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
        .set({
          pendingOriginal: "over.wav",
          pendingFilename: "over.wav",
          pendingUploadedAt: new Date("2026-11-02T10:00:00Z"),
        })
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
      assert.deepEqual(overRange.uploadedAt, initial.uploadedAt);
      assert.deepEqual(
        await readFile(join(directory, overRange.original!)),
        uploadedBytes,
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
          pendingUploadedAt: new Date("2026-11-04T11:00:00Z"),
        })
        .where(eq(versions.id, version));
      await boss.send(
        "process-audio",
        { versionId: version },
        { singletonKey: version },
      );
      child = await spawnWorker(directory);
      const replaced = await waitFor(version);
      assert.equal(replaced.error, null);
      assert.equal(replaced.original, "replacement.wav");
      assert.equal(replaced.position, initial.position);
      assert.deepEqual(replaced.createdAt, initial.createdAt);
      assert.equal(
        replaced.uploadedAt?.toISOString(),
        "2026-11-04T11:00:00.000Z",
      );
      assert.equal(replaced.pendingUploadedAt, null);
      assert.equal(replaced.original, replaced.playback);
      await removed(initial.original!);
      await removed(initial.playback!);
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

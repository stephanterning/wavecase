import { stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { eq, and, sql, isNotNull } from "drizzle-orm";
import { removeAudioFiles } from "./audio-files";
import { db } from "./db";
import { prepareStream, streamManifest } from "./audio-stream";
import { streamFile } from "./storage-keys";
import { versions, comments, releaseTracks } from "./schema";
import { boss, queue } from "./queue";
import { processAudio, sameDuration } from "./audio";
import { commentTime } from "../domain/comment-time";
import { InvalidAudioError, retryProcessing } from "./processing-errors";
import { startReleaseWorker, reconcileReleases } from "./release-worker";
import { deleteExpiredTokens } from "./security";
import { dataDir } from "./config";
const directory = dataDir();
await queue();
await startReleaseWorker();
await boss.work<{ key: string }>("prepare-stream", async (jobs) => {
  for (const job of jobs) {
    try {
      await prepareStream(directory, job.data.key);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
});
await boss.work<{ versionId: string }>("process-audio", async (jobs) => {
  for (const job of jobs) {
    const version = await db.query.versions.findFirst({
      where: eq(versions.id, job.data.versionId),
    });
    const key = version?.pendingOriginal;
    if (!version || !key) continue;
    try {
      const result = await processAudio(directory, key);
      const changed = await db.transaction(async (tx) => {
        // FOR UPDATE also excludes new comments until the duration check commits.
        await tx.execute(
          sql`select id from versions where id=${version.id} for update`,
        );
        const current = await tx.query.versions.findFirst({
          where: eq(versions.id, version.id),
        });
        if (current?.pendingOriginal !== key) return false;
        const comment = await tx.query.comments.findFirst({
          where: eq(comments.versionId, version.id),
        });
        const metadata = current.metadata as {
          samples: number;
          sampleRate: number;
        } | null;
        if (comment && metadata && !sameDuration(metadata, result.metadata))
          throw new InvalidAudioError(
            `Replacement must have exactly the same duration because this version has comments. Current: ${commentTime(metadata.samples / metadata.sampleRate)}, replacement: ${commentTime(result.metadata.samples / result.metadata.sampleRate)}.`,
          );
        await tx
          .update(versions)
          .set({
            ...result,
            filename: current.pendingFilename!,
            uploadedAt: current.pendingUploadedAt ?? current.createdAt,
            pendingOriginal: null,
            pendingFilename: null,
            pendingUploadedAt: null,
            state: "ready",
            error: null,
          })
          .where(eq(versions.id, version.id));
        return true;
      });
      // The upload remains intact until validation and the database commit succeed.
      const cleanup = changed
        ? [version.original, version.playback].filter(
            (p) => p !== result.original && p !== result.playback,
          )
        : [key, result.playback];
      await removeAudioFiles(directory, cleanup);
    } catch (error) {
      if (retryProcessing(error, job)) throw error;
      const failed = await db
        .update(versions)
        .set({
          state: version.playback
            ? "ready"
            : version.state === "missing"
              ? "missing"
              : "failed",
          error:
            error instanceof InvalidAudioError
              ? error.message
              : "Audio could not be processed. Check the format and try again.",
          pendingOriginal: null,
          pendingFilename: null,
          pendingUploadedAt: null,
        })
        .where(
          and(eq(versions.id, version.id), eq(versions.pendingOriginal, key)),
        )
        .returning({ id: versions.id });
      // A failure after publication must not remove the now active audio.
      if (failed.length) await removeAudioFiles(directory, [key]);
    }
  }
});
// Reconcile pending uploads so a crash between storing a file and queueing it is recoverable.
async function reconcile() {
  await deleteExpiredTokens();
  await reconcileReleases();
  const sources = await db
    .select({ key: versions.playback })
    .from(versions)
    .where(and(isNotNull(versions.playback), eq(versions.state, "ready")));
  const demos = new Set(sources.map((source) => source.key));
  const releases = await db
    .select({ key: releaseTracks.playback })
    .from(releaseTracks)
    .where(isNotNull(releaseTracks.playback));
  for (const { key } of releases) {
    if (!key || demos.has(key)) continue;
    if (!key.endsWith(".mp3")) {
      sources.push({ key });
      continue;
    }
    // Old deployments prepared PCM for releases. Only remove the derived pair.
    await rm(join(directory, streamFile(key, "json")), { force: true });
    await rm(join(directory, streamFile(key, "pcm")), { force: true });
  }
  for (const { key } of sources) {
    if (!key) continue;
    const prepared = await streamManifest(directory, key);
    if (prepared?.flacRate) {
      // Recover a crash between publishing the FLAC index and retiring the PCM.
      await rm(join(directory, streamFile(key, "pcm")), { force: true });
      continue;
    }
    if (prepared?.pcmCodecChecked) continue;
    try {
      await stat(join(directory, key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await boss.send(
      "prepare-stream",
      { key },
      { singletonKey: key, retryLimit: 3, retryDelay: 10 },
    );
  }
  const pending = await db
    .select({ id: versions.id })
    .from(versions)
    .where(isNotNull(versions.pendingOriginal));
  for (const version of pending)
    await boss.send(
      "process-audio",
      { versionId: version.id },
      { singletonKey: version.id, retryLimit: 3, retryDelay: 10 },
    );
}
await reconcile();
const reconciliation = setInterval(
  () => void reconcile().catch(console.error),
  60000,
);
console.log("Wavecase audio worker ready");
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, async () => {
    clearInterval(reconciliation);
    await boss.stop();
    process.exit(0);
  });

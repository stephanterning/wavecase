import { eq, and, sql, isNotNull } from "drizzle-orm";
import { removeAudioFiles } from "./audio-files";
import { db } from "./db";
import { versions, comments } from "./schema";
import { boss, queue } from "./queue";
import { processAudio, sameDuration } from "./audio";
import { startReleaseWorker, reconcileReleases } from "./release-worker";
const directory = process.env.DATA_DIR || "data/audio";
await queue();
await startReleaseWorker();
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
        if (
          comment &&
          current.metadata &&
          !sameDuration(
            current.metadata as { samples: number; sampleRate: number },
            result.metadata,
          )
        )
          throw new Error(
            "Replacement must have exactly the same duration because this version has comments.",
          );
        await tx
          .update(versions)
          .set({
            ...result,
            filename:
              result.metadata.mime === "audio/wav"
                ? current.pendingFilename!.replace(/\.[^.]+$/, "") + ".wav"
                : current.pendingFilename!,
            pendingOriginal: null,
            pendingFilename: null,
            state: "ready",
            error: null,
          })
          .where(eq(versions.id, version.id));
        return true;
      });
      // The upload remains intact until validation and the database commit succeed.
      const cleanup = changed
        ? [version.original, version.playback, key].filter(
            (p) => p !== result.original,
          )
        : [key, result.original];
      await removeAudioFiles(directory, cleanup);
    } catch (error) {
      if (
        error instanceof Error &&
        /No space left|Resource temporarily unavailable|Input.output error|EMFILE|ENOSPC/.test(
          error.message,
        ) &&
        job.retryCount < 3
      )
        throw error;
      await db
        .update(versions)
        .set({
          state: version.playback
            ? "ready"
            : version.state === "missing"
              ? "missing"
              : "failed",
          error:
            error instanceof Error &&
            /^(Replacement|Upload mono|Audio exceeds)/.test(error.message)
              ? error.message
              : "Audio could not be processed. Check the format and try again.",
          pendingOriginal: null,
          pendingFilename: null,
        })
        .where(
          and(eq(versions.id, version.id), eq(versions.pendingOriginal, key)),
        );
      await removeAudioFiles(directory, [key, key + ".wav"]);
    }
  }
});
// Reconcile pending uploads so a crash between storing a file and queueing it is recoverable.
async function reconcile() {
  await reconcileReleases();
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

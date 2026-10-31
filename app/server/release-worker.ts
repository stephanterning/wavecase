import { removeAudioFiles } from "./audio-files";
import { and, eq, isNotNull, isNull, or } from "drizzle-orm";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./db";
import { releaseTracks } from "./schema";
import { boss } from "./queue";
import { processReleaseAudio, measureReleasePlayback } from "./release-audio";
const directory = process.env.DATA_DIR || "data/audio";
export async function startReleaseWorker() {
  await boss.work<{ trackId: string }>("process-release", async (jobs) => {
    for (const job of jobs) {
      const track = await db.query.releaseTracks.findFirst({
        where: eq(releaseTracks.id, job.data.trackId),
      });
      const key = track?.pendingOriginal;
      if (!track) continue;
      if (!key) {
        // Backfill measurements without re-encoding or replacing existing files.
        if (track.playback && !track.audioMeasurements) {
          const audioMeasurements = await measureReleasePlayback(
            directory,
            track.playback,
          );
          await db
            .update(releaseTracks)
            .set({ audioMeasurements })
            .where(
              and(
                eq(releaseTracks.id, track.id),
                eq(releaseTracks.playback, track.playback),
                isNull(releaseTracks.audioMeasurements),
              ),
            );
        }
        continue;
      }
      try {
        const result = await processReleaseAudio(directory, key);
        const changed = await db
          .update(releaseTracks)
          .set({ ...result, original: key, pendingOriginal: null, error: null })
          .where(
            and(
              eq(releaseTracks.id, track.id),
              eq(releaseTracks.pendingOriginal, key),
            ),
          )
          .returning({ id: releaseTracks.id });
        const cleanup = changed.length
          ? [track.original, track.playback]
          : [key, result.playback];
        await removeAudioFiles(
          directory,
          cleanup.filter((p) => p !== (changed.length ? key : "")),
        );
      } catch (error) {
        if (
          job.retryCount < 3 &&
          error instanceof Error &&
          /ENOSPC|EMFILE|temporarily unavailable|Input.output/.test(
            error.message,
          )
        )
          throw error;
        await db
          .update(releaseTracks)
          .set({
            pendingOriginal: null,
            error:
              "Could not process this file. Upload a valid mono or stereo PCM WAV within the configured size and duration limits.",
          })
          .where(
            and(
              eq(releaseTracks.id, track.id),
              eq(releaseTracks.pendingOriginal, key),
            ),
          );
        await Promise.all(
          [key, key + ".m4a"].map((p) =>
            unlink(join(directory, p)).catch(() => {}),
          ),
        );
      }
    }
  });
}
export async function reconcileReleases() {
  const pending = await db
    .select({ id: releaseTracks.id })
    .from(releaseTracks)
    .where(
      or(
        isNotNull(releaseTracks.pendingOriginal),
        and(
          isNotNull(releaseTracks.playback),
          isNull(releaseTracks.audioMeasurements),
        ),
      ),
    );
  for (const track of pending)
    await boss.send(
      "process-release",
      { trackId: track.id },
      { singletonKey: track.id, retryLimit: 3, retryDelay: 10 },
    );
}

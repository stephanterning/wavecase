import { encodeMp3 } from "./audio-exports";
import { removeAudioFiles } from "./audio-files";
import { and, eq, isNotNull, isNull, notLike, or } from "drizzle-orm";
import { db } from "./db";
import { releaseTracks } from "./schema";
import { boss } from "./queue";
import { processReleaseAudio, measureReleasePlayback } from "./release-audio";
import { retryProcessing } from "./processing-errors";
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
        await upgradeReleasePlayback(track.id);
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
        if (retryProcessing(error, job)) throw error;
        const failed = await db
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
          )
          .returning({ id: releaseTracks.id });
        if (failed.length)
          await removeAudioFiles(directory, [key, key + ".m4a"]);
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
          or(
            isNull(releaseTracks.audioMeasurements),
            notLike(releaseTracks.playback, "%.mp3"),
          ),
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

// Keep existing playback available until the MP3 and its measurements are ready.
export async function upgradeReleasePlayback(trackId: string) {
  const track = () =>
    db.query.releaseTracks.findFirst({ where: eq(releaseTracks.id, trackId) });
  const current = await track();
  if (!current?.original || !current.playback || current.pendingOriginal)
    return;
  if (current.playback.endsWith(".mp3") && current.audioMeasurements) return;
  const playback = await encodeMp3(directory, current.original);
  const audioMeasurements = await measureReleasePlayback(directory, playback);
  const upgraded = await db
    .update(releaseTracks)
    .set({ playback, audioMeasurements })
    .where(
      and(
        eq(releaseTracks.id, trackId),
        eq(releaseTracks.original, current.original),
        eq(releaseTracks.playback, current.playback),
      ),
    )
    .returning({ id: releaseTracks.id });
  if (!upgraded.length) {
    // Removal or replacement has already deleted the files of the old master.
    if ((await track())?.original !== current.original)
      await removeAudioFiles(directory, [current.original]);
    return;
  }
  if (current.playback !== playback && current.playback !== current.original)
    await removeAudioFiles(directory, [current.playback]);
}

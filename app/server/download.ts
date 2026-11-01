import { eq } from "drizzle-orm";
import { db } from "./db";
import { releaseTracks, versions } from "./schema";
import type { DownloadFormat } from "../domain/download-details";
import {
  encodeMp3,
  encodeWav,
  encodeFlac,
  probeDownload,
} from "./audio-exports";
export {
  encodeMp3,
  encodeWav,
  encodeFlac,
  probeDownload,
} from "./audio-exports";

function encodeDownload(
  directory: string,
  original: string,
  format: DownloadFormat,
) {
  if (format === "original") return Promise.resolve(original);
  if (format === "wav") return encodeWav(directory, original);
  if (format === "flac") return encodeFlac(directory, original);
  return encodeMp3(directory, original);
}

export async function demoWavAvailable(
  version: {
    original: string | null;
    metadata: Record<string, unknown> | null;
  },
  directory: string,
) {
  if (!version.original) return false;
  if (Number(version.metadata?.audioPolicy) >= 2)
    return version.metadata?.wavDownload === true;
  return (await probeDownload(directory, version.original)).plan.wavDownload;
}

export async function releaseAudioDownload(
  trackId: string,
  original: string,
  directory: string,
  format: DownloadFormat,
) {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(releaseTracks)
      .where(eq(releaseTracks.id, trackId))
      .for("update");
    if (current?.original !== original || !current.playback)
      throw new Response("Audio changed. Please try again.", { status: 409 });
    return encodeDownload(directory, original, format);
  });
}

export async function demoAudioDownload(
  versionId: string,
  original: string,
  directory: string,
  format: DownloadFormat,
) {
  // Serialize encoding across web processes and coordinate with replacement/removal.
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(versions)
      .where(eq(versions.id, versionId))
      .for("update");
    if (current?.original !== original || current.state !== "ready")
      throw new Response("Audio changed. Please try again.", { status: 409 });
    if (format === "wav" || format === "flac") {
      if (!(await demoWavAvailable(current, directory)))
        throw new Response("Download format unavailable", { status: 400 });
    }
    return encodeDownload(directory, original, format);
  });
}

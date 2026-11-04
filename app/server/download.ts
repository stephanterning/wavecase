import { eq } from "drizzle-orm";
import { removeAudioFiles } from "./audio-files";
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

const changed = () =>
  new Response("Audio changed. Please try again.", { status: 409 });

// Encoding holds no row lock. Replacement and removal delete an upload's files
// after committing, so an export finished for a superseded upload is removed here.
async function encodeCurrent(
  directory: string,
  original: string,
  format: DownloadFormat,
  current: () => Promise<string | null | undefined>,
) {
  try {
    const file = await encodeDownload(directory, original, format);
    if ((await current()) === original) return file;
  } catch (error) {
    if ((await current()) === original) throw error;
  }
  await removeAudioFiles(directory, [original]);
  throw changed();
}

export async function releaseAudioDownload(
  trackId: string,
  original: string,
  directory: string,
  format: DownloadFormat,
) {
  const track = () =>
    db.query.releaseTracks.findFirst({ where: eq(releaseTracks.id, trackId) });
  const current = await track();
  if (current?.original !== original || !current.playback) throw changed();
  return encodeCurrent(
    directory,
    original,
    format,
    async () => (await track())?.original,
  );
}

export async function demoAudioDownload(
  versionId: string,
  original: string,
  directory: string,
  format: DownloadFormat,
) {
  const version = () =>
    db.query.versions.findFirst({ where: eq(versions.id, versionId) });
  const current = await version();
  if (current?.original !== original || current.state !== "ready")
    throw changed();
  if (format === "wav" || format === "flac") {
    if (!(await demoWavAvailable(current, directory)))
      throw new Response("Download format unavailable", { status: 400 });
  }
  return encodeCurrent(
    directory,
    original,
    format,
    async () => (await version())?.original,
  );
}

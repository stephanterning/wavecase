import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./db";
import { versions } from "./schema";
import { boss, queue } from "./queue";
import { dataDir, maxUploadBytes } from "./config";
import { storeUpload, type Upload } from "./request";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  defaultVersionStatus,
  nextVersionName,
  versionNameFromFile,
  versionStatuses,
} from "../domain/versions";
export const audioUploadError =
  "Choose an audio file within the upload size limit.";
export async function uploadVersion(
  trackId: string,
  form: FormData,
  file: Upload | undefined,
) {
  const status = z
    .enum(versionStatuses)
    .parse(form.get("status") || defaultVersionStatus);
  if (!file) throw new Response(audioUploadError, { status: 400 });
  const id = await storeUpload(file, {
    limit: maxUploadBytes(),
    error: audioUploadError,
  });
  const path = join(dataDir(), id);
  try {
    const name =
      String(form.get("name") || "") ||
      versionNameFromFile(file.name) ||
      nextVersionName(
        (
          await db
            .select({ name: versions.name })
            .from(versions)
            .where(eq(versions.trackId, trackId))
        ).map((version) => version.name),
      );
    await db.insert(versions).values({
      id,
      trackId,
      status,
      name: name.slice(0, 100),
      description: String(form.get("description") || "").slice(0, 5000),
      download: form.has("download"),
      filename: file.name,
      pendingOriginal: id,
      pendingFilename: file.name,
      pendingUploadedAt: new Date(),
    });
  } catch (error) {
    await unlink(path).catch(() => {});
    throw error;
  }
  try {
    await queue();
    await boss.send(
      "process-audio",
      { versionId: id },
      { singletonKey: id, retryLimit: 3, retryDelay: 10 },
    );
  } catch (error) {
    console.error(
      "Upload retained for worker reconciliation",
      error instanceof Error ? error.message : "Queue unavailable",
    );
  }
  return id;
}

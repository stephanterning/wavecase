import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { versions } from "./schema";
import { boss, queue } from "./queue";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  defaultVersionStatus,
  nextVersionName,
  versionNameFromFile,
  versionStatuses,
} from "../domain/versions";
export async function uploadVersion(trackId: string, form: FormData) {
  const status = z
    .enum(versionStatuses)
    .parse(form.get("status") || defaultVersionStatus);
  const file = form.get("audio");
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024
  )
    throw new Response("Choose an audio file within the upload size limit.", {
      status: 400,
    });
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
  const id = randomUUID(),
    directory = process.env.DATA_DIR || "data/audio";
  await mkdir(directory, { recursive: true });
  const path = join(directory, id);
  await writeFile(path, Buffer.from(await file.arrayBuffer()));
  try {
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

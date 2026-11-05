import { redirect } from "react-router";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "./db";
import { releases, releaseTracks, releaseEvents } from "./schema";
import { sameOrigin } from "./security";
import { storeUpload, uploadForm, type Upload } from "./request";
import { maxUploadBytes } from "./config";
import { removeAudioFiles } from "./audio-files";
import { directory, formError, releaseAccess, storeArtwork } from "./releases";
import { boss, queue } from "./queue";
import { releaseFields, trackFields, parseLinks } from "../domain/releases";

type Release = Awaited<ReturnType<typeof releaseAccess>>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Track = typeof releaseTracks.$inferSelect;

export async function releaseEditorAction(request: Request, id: string) {
  sameOrigin(request);
  const data = await releaseAccess(request, id, true);
  let upload: Awaited<ReturnType<typeof uploadForm>> | undefined;
  try {
    upload = await uploadForm(request, maxUploadBytes() + 65536);
    const { form, files } = upload;
    const intent = form.get("intent");
    let removedFiles: string[] = [];
    if (intent === "delete") {
      await removeAudioFiles(directory(), await deleteRelease(data.release.id));
      return redirect("/releases");
    } else if (intent === "metadata") await saveDetails(data, form);
    else if (intent === "publish") await publish(data);
    else if (intent === "unpublish") await setPublished(data, false);
    else if (intent === "cover") removedFiles = await saveCover(data, files);
    else if (intent === "add-track") await addTrack(data, form);
    else removedFiles = await updateTrack(data, intent, form, files);
    await removeAudioFiles(directory(), removedFiles);
    if (form.has("_inline")) return { saved: true, error: undefined };
    return redirect(`/releases/${data.release.id}`);
  } catch (error) {
    return formError(error);
  } finally {
    await upload?.discard();
  }
}

function textFields(form: FormData, fields: readonly string[]) {
  return Object.fromEntries(
    fields.map((key) => [
      key,
      z
        .string()
        .trim()
        .max(5000)
        .parse(form.get(key) || ""),
    ]),
  );
}

function title(form: FormData) {
  return z.string().trim().min(1).max(200).parse(form.get("title"));
}

async function deleteRelease(id: string) {
  return db.transaction(async (tx) => {
    const [release] = await tx
      .select()
      .from(releases)
      .where(eq(releases.id, id))
      .for("update");
    if (!release) throw new Response("Release not found", { status: 404 });
    if (release.published)
      throw new Response("Unpublish this release before deleting it.", {
        status: 409,
      });
    const tracks = await tx
      .select()
      .from(releaseTracks)
      .where(eq(releaseTracks.releaseId, release.id))
      .for("update");
    await tx
      .delete(releaseEvents)
      .where(eq(releaseEvents.releaseId, release.id));
    await tx
      .delete(releaseTracks)
      .where(eq(releaseTracks.releaseId, release.id));
    await tx.delete(releases).where(eq(releases.id, release.id));
    return [
      release.cover,
      ...tracks.flatMap((track) => [
        track.original,
        track.playback,
        track.pendingOriginal,
      ]),
    ];
  });
}

async function saveDetails(data: Release, form: FormData) {
  const metadata = textFields(form, releaseFields);
  if (
    metadata.releaseDate &&
    !z.iso.date().safeParse(metadata.releaseDate).success
  )
    throw new Response("Enter a valid release date.", { status: 400 });
  await db
    .update(releases)
    .set({
      title: title(form),
      kind: z.enum(["single", "ep", "album"]).parse(form.get("kind")),
      description: z.string().max(5000).parse(form.get("description")),
      metadata,
      links: parseLinks(String(form.get("links") || "")),
      audioEnabled: form.has("audioEnabled"),
    })
    .where(eq(releases.id, data.release.id));
}

async function publish(data: Release) {
  if (!data.release.cover)
    throw new Response("Upload artwork before publishing.", { status: 400 });
  if (!data.tracks.length)
    throw new Response(
      "Add at least one track before publishing. Audio is optional.",
      { status: 400 },
    );
  await setPublished(data, true);
}

async function setPublished(data: Release, published: boolean) {
  await db
    .update(releases)
    .set({ published })
    .where(eq(releases.id, data.release.id));
}

async function saveCover(data: Release, files: Map<string, Upload>) {
  const file = files.get("cover");
  if (!file) throw new Response("Choose artwork", { status: 400 });
  const key = await storeArtwork(file);
  await db
    .update(releases)
    .set({ cover: key })
    .where(eq(releases.id, data.release.id));
  return data.release.cover ? [data.release.cover] : [];
}

async function addTrack(data: Release, form: FormData) {
  await db.transaction(async (tx) => {
    await tx
      .select()
      .from(releases)
      .where(eq(releases.id, data.release.id))
      .for("no key update");
    const rows = await tx
      .select()
      .from(releaseTracks)
      .where(eq(releaseTracks.releaseId, data.release.id));
    await tx.insert(releaseTracks).values({
      releaseId: data.release.id,
      title: title(form),
      position: Math.max(0, ...rows.map((t) => t.position)) + 1,
    });
  });
}

/** Track intents lock the release and the track. Audio is written to disk
 * before the transaction so no lock is held while the upload is stored. */
async function updateTrack(
  data: Release,
  intent: FormDataEntryValue | null,
  form: FormData,
  files: Map<string, Upload>,
) {
  const id = z.uuid().parse(form.get("track"));
  let key: string | undefined;
  if (intent === "audio") {
    const file = files.get("audio");
    if (!file) throw new Response("Choose a WAV file", { status: 400 });
    key = await storeUpload(file, { limit: maxUploadBytes() });
  }
  const removedFiles = await db
    .transaction(async (tx) => {
      await tx
        .select()
        .from(releases)
        .where(eq(releases.id, data.release.id))
        .for("no key update");
      const [track] = await tx
        .select()
        .from(releaseTracks)
        .where(
          and(
            eq(releaseTracks.id, id),
            eq(releaseTracks.releaseId, data.release.id),
          ),
        )
        .for("no key update");
      if (!track) throw new Response("Track not found", { status: 404 });
      if (intent === "track") await saveTrack(tx, track, form);
      else if (intent === "audio") await replaceTrackAudio(tx, track, key!);
      else if (intent === "remove-audio") return removeTrackAudio(tx, track);
      else throw new Response("Unknown action", { status: 400 });
      return [];
    })
    .catch(async (error) => {
      if (key) await unlink(join(directory(), key)).catch(() => {});
      throw error;
    });
  if (intent === "audio") {
    try {
      await queue();
      await boss.send(
        "process-release",
        { trackId: id },
        { singletonKey: id, retryLimit: 3, retryDelay: 10 },
      );
    } catch {
      console.error("Release upload retained for worker reconciliation");
    }
  }
  return removedFiles;
}

async function saveTrack(tx: Transaction, track: Track, form: FormData) {
  const position = z.coerce
    .number()
    .int()
    .min(1)
    .max(999)
    .parse(form.get("position"));
  if (position !== track.position)
    await tx
      .update(releaseTracks)
      .set({ position: track.position })
      .where(
        and(
          eq(releaseTracks.releaseId, track.releaseId),
          eq(releaseTracks.position, position),
        ),
      );
  await tx
    .update(releaseTracks)
    .set({
      title: title(form),
      position,
      metadata: {
        ...textFields(form, trackFields),
        explicit: form.has("explicit"),
      },
    })
    .where(eq(releaseTracks.id, track.id));
}

async function replaceTrackAudio(tx: Transaction, track: Track, key: string) {
  if (track.pendingOriginal)
    throw new Response("This track already has an upload processing.", {
      status: 409,
    });
  await tx
    .update(releaseTracks)
    .set({ pendingOriginal: key, error: null })
    .where(eq(releaseTracks.id, track.id));
}

async function removeTrackAudio(tx: Transaction, track: Track) {
  await tx
    .update(releaseTracks)
    .set({
      original: null,
      playback: null,
      audioMeasurements: null,
      pendingOriginal: null,
      duration: null,
      sampleRate: null,
      bitDepth: null,
      error: null,
    })
    .where(eq(releaseTracks.id, track.id));
  return [track.original, track.playback, track.pendingOriginal].filter(
    (p): p is string => !!p,
  );
}

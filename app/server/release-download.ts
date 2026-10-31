import { releaseMp3Download } from "./download";
import { downloadName, zipDisposition } from "./release-filenames";
import { ZipFile } from "yazl";
import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { directory, releaseAccess } from "./releases";
import { emailSchema, releaseInfo } from "../domain/releases";
import { db } from "./db";
import { releaseEvents } from "./schema";
export async function downloadRelease(
  request: Request,
  id: string,
  form: FormData,
) {
  let data = await releaseAccess(request, id);
  if (
    !data.release.published ||
    !data.release.audioEnabled ||
    !data.release.cover
  )
    throw new Response("Downloads unavailable", { status: 403 });
  const parsed = emailSchema.safeParse(String(form.get("email") || "").trim());
  if (!parsed.success)
    throw new Response("Enter an email address in a valid format.", {
      status: 400,
    });
  const selection = String(form.get("track") || "");
  let tracks = data.tracks.filter(
    (t) => t.original && t.playback && (!selection || t.id === selection),
  );
  if (!tracks.length)
    throw new Response("No audio available for this download", { status: 404 });
  const format = String(form.get("format") || "wav");
  if (format !== "wav" && format !== "mp3")
    throw new Response("Download format unavailable", { status: 400 });
  const audioFiles = new Map<string, string>();
  for (const track of tracks) {
    try {
      audioFiles.set(
        track.id,
        format === "mp3"
          ? await releaseMp3Download(track.id, track.original!, directory())
          : track.original!,
      );
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error(
        "Release MP3 encoding failed",
        error instanceof Error ? error.message : error,
      );
      throw new Response("MP3 could not be prepared. Please try again.", {
        status: 503,
      });
    }
  }
  // Encoding an album can take time. Recheck publication, permissions and sources.
  const current = await releaseAccess(request, id);
  if (
    !current.release.published ||
    !current.release.audioEnabled ||
    !current.release.cover
  )
    throw new Response("Downloads unavailable", { status: 403 });
  if (
    tracks.some(
      (t) =>
        !current.tracks.some(
          (c) => c.id === t.id && c.original === t.original && c.playback,
        ),
    )
  )
    throw new Response("Audio changed. Please try again.", { status: 409 });
  tracks = current.tracks.filter((t) => audioFiles.has(t.id));
  data = current;
  const trackArtist = (track: (typeof tracks)[number]) =>
    track.metadata.artist?.trim() || data.artist.name;
  const folder = downloadName(
    selection
      ? `${trackArtist(tracks[0])} - ${tracks[0].title}`
      : `${data.artist.name} - ${data.release.title}`,
  );
  const files = tracks.map((t) => ({
    path: join(directory(), audioFiles.get(t.id)!),
    name: `${folder}/${downloadName(`${String(t.position).padStart(2, "0")} - ${trackArtist(t)} - ${t.title}`)}.${format}`,
  }));
  files.push({
    path: join(directory(), current.release.cover),
    name: `${folder}/artwork.png`,
  });
  await Promise.all(files.map((f) => stat(f.path)));
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  const info = releaseInfo(
    data.release,
    data.artist.name,
    tracks,
    data.tracks.length,
    format,
  );
  // Stream stored entries; never buffer full masters or a complete album in memory.
  for (const file of files)
    zip.addFile(file.path, file.name, { compress: false });
  zip.addBuffer(Buffer.from(info), `${folder}/release-info.txt`);
  zip.on("error", (error) => output.destroy(error));
  await db.insert(releaseEvents).values({
    releaseId: id,
    kind: "download-started",
    trackId: selection || null,
    email: parsed.data,
    detail: `${format.toUpperCase()}\n${tracks.map((t) => `${t.position}. ${t.title}`).join("\n")}`,
  });
  zip.end();
  return new Response(Readable.toWeb(output) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": zipDisposition(folder),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

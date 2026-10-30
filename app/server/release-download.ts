import { ZipFile } from "yazl";
import { Readable } from "node:stream";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { directory, releaseAccess } from "./releases";
import { emailSchema, releaseInfo, slugify } from "../domain/releases";
import { db } from "./db";
import { releaseEvents } from "./schema";
export async function downloadRelease(
  request: Request,
  id: string,
  form: FormData,
) {
  const data = await releaseAccess(request, id);
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
  const tracks = data.tracks.filter(
    (t) => t.original && t.playback && (!selection || t.id === selection),
  );
  if (!tracks.length)
    throw new Response("No audio available for this download", { status: 404 });
  const files = tracks.map((t, index) => ({
    path: join(directory(), t.original!),
    name: `${String(index + 1).padStart(2, "0")}-${slugify(t.title) || "track"}.wav`,
  }));
  files.push({
    path: join(directory(), data.release.cover),
    name: "artwork.png",
  });
  await Promise.all(files.map((f) => stat(f.path)));
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  const info = releaseInfo(
    data.release,
    data.artist.name,
    tracks,
    data.tracks.length,
  );
  // Stream stored entries; never buffer full masters or a complete album in memory.
  for (const file of files)
    zip.addFile(file.path, file.name, { compress: false });
  zip.addBuffer(Buffer.from(info), "release-info.txt");
  zip.on("error", (error) => output.destroy(error));
  await db.insert(releaseEvents).values({
    releaseId: id,
    kind: "download-started",
    trackId: selection || null,
    email: parsed.data,
    detail: tracks.map((t) => `${t.position}. ${t.title}`).join("\n"),
  });
  zip.end();
  return new Response(Readable.toWeb(output) as ReadableStream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${slugify(selection ? tracks[0].title : data.release.title) || "release"}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

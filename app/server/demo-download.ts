import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { Readable } from "node:stream";
import { and, desc, eq } from "drizzle-orm";
import { ZipFile } from "yazl";
import { z } from "zod";
import { emailSchema } from "../domain/releases";
import { versionAccess } from "./access";
import { db } from "./db";
import { mp3Download } from "./download";
import { downloadName, zipDisposition } from "./release-filenames";
import { events } from "./schema";
import { linkedArtist } from "./track-artist";
import { visitorContext } from "./visitor";

export async function downloadDemo(
  request: Request,
  id: string,
  form: FormData,
) {
  const share = String(form.get("share") || "") || undefined;
  let access = await versionAccess(request, id, share);
  const permitted = (value: typeof access) => {
    if (!value.owner && !(value.link?.download && value.version.download))
      throw new Response("Download unavailable", { status: 403 });
  };
  permitted(access);
  const email = emailSchema.safeParse(String(form.get("email") || "").trim());
  if (!access.owner && !email.success)
    throw new Response("Enter an email address in a valid format.", {
      status: 400,
    });
  const { version } = access;
  const modern = version.metadata?.audioPolicy === 2;
  const format = String(
    form.get("format") ||
      (modern ? (version.metadata?.wavDownload ? "wav" : "mp3") : "original"),
  );
  if (
    modern
      ? !["wav", "mp3"].includes(format) ||
        (format === "wav" && !version.metadata?.wavDownload)
      : format !== "original"
  )
    throw new Response("Download format unavailable", { status: 400 });
  let file = version.original;
  if (!file || version.state !== "ready")
    throw new Response("Audio file missing", { status: 404 });
  const directory = process.env.DATA_DIR || "data/audio";
  if (format === "mp3") {
    try {
      file = await mp3Download(version.id, file, directory);
    } catch (error) {
      if (error instanceof Response) throw error;
      console.error(
        "MP3 encoding failed",
        error instanceof Error ? error.message : error,
      );
      throw new Response("MP3 could not be prepared. Please try again.", {
        status: 503,
      });
    }
  }
  // Encoding may take time: recheck access and audio before creating the package.
  access = await versionAccess(request, id, share);
  permitted(access);
  if (
    access.version.original !== version.original ||
    access.version.state !== "ready"
  )
    throw new Response("Audio changed. Please try again.", { status: 409 });
  if (!access.owner && !email.success)
    throw new Response("Enter an email address in a valid format.", {
      status: 400,
    });
  const { track, owner, link } = access;
  const current = access.version;
  const artist =
    (await linkedArtist(track.ownerId, track.artistId))?.name || track.artist;
  const folder = downloadName(
    [artist, track.title, current.name].filter(Boolean).join(" - "),
  );
  const extension = modern
    ? `.${format}`
    : extname(downloadName(version.filename));
  const files = [
    { path: join(directory, file), name: `${folder}/${folder}${extension}` },
  ];
  if (track.cover)
    files.push({
      path: join(directory, track.cover),
      name: `${folder}/artwork.jpg`,
    });
  await Promise.all(files.map((f) => stat(f.path)));
  const info = [
    "Pre-release version. Do not share.",
    "",
    ...(artist ? [`Artist: ${artist}`] : []),
    `Title: ${track.title}`,
    `Version: ${current.name}`,
    `Status: ${current.status}`,
    `Uploaded: ${current.createdAt.toISOString()}`,
    `Format: ${format.toUpperCase()}`,
    ...(track.description ? ["", "Track description:", track.description] : []),
    ...(current.description
      ? ["", "Version description:", current.description]
      : []),
    "",
  ].join("\n");
  if (!owner) {
    const browser = z.uuid().safeParse(form.get("browser"));
    const session = z.uuid().safeParse(form.get("session"));
    const previous = browser.success
      ? await db.query.events.findFirst({
          where: and(
            eq(events.linkId, link!.id),
            eq(events.browser, browser.data),
          ),
          orderBy: desc(events.createdAt),
        })
      : null;
    const context = previous?.context as { referrer?: string | null } | null;
    await db.insert(events).values({
      versionId: id,
      linkId: link!.id,
      browser: browser.success ? browser.data : randomUUID(),
      session: session.success ? session.data : randomUUID(),
      kind: "download-started",
      name: previous?.name,
      context: {
        ...(await visitorContext(request, context?.referrer)),
        format,
        email: email.data,
      },
    });
  }
  const zip = new ZipFile();
  const output = zip.outputStream as Readable;
  zip.on("error", (error) => output.destroy(error));
  for (const file of files)
    zip.addFile(file.path, file.name, { compress: false });
  zip.addBuffer(Buffer.from(info), `${folder}/demo-info.txt`);
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

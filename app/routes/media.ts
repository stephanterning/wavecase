import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../server/db";
import { events } from "../server/schema";
import { and, desc, eq } from "drizzle-orm";
import { visitorContext } from "../server/visitor";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import { mp3Download } from "../server/download";
import { versionAccess } from "../server/access";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const { version, owner, link } = await versionAccess(
    request,
    params.id!,
    query.get("share") || undefined,
  );
  const download = query.has("download");
  if (download && !owner && !(link?.download && version.download))
    throw new Response("Download unavailable", { status: 403 });
  const modern = version.metadata?.audioPolicy === 2;
  const format = download
    ? query.get("format") ||
      (modern ? (version.metadata?.wavDownload ? "wav" : "mp3") : "original")
    : "playback";
  if (
    download &&
    (modern
      ? !["wav", "mp3"].includes(format) ||
        (format === "wav" && !version.metadata?.wavDownload)
      : format !== "original")
  )
    throw new Response("Download format unavailable", { status: 400 });
  let file = download ? version.original : version.playback;
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
    // A first download can take time. Revoked permissions must still take effect.
    const fresh = await versionAccess(
      request,
      params.id!,
      query.get("share") || undefined,
    );
    if (!fresh.owner && !(fresh.link?.download && fresh.version.download))
      throw new Response("Download unavailable", { status: 403 });
    if (
      fresh.version.original !== version.original ||
      fresh.version.state !== "ready"
    )
      throw new Response("Audio changed. Please try again.", { status: 409 });
  }
  const path = join(directory, file);
  const { size } = await stat(path);
  const headers = new Headers({
    "Content-Type": download
      ? format === "mp3"
        ? "audio/mpeg"
        : format === "wav"
          ? "audio/wav"
          : "application/octet-stream"
      : String(version.metadata?.mime || "audio/wav"),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  const etag = '"' + version.original + ":" + format + ":" + size + '"';
  headers.set("ETag", etag);
  // Authorization runs before conditional responses so cached bytes never bypass a revoked link.
  if (
    !download &&
    !request.headers.has("range") &&
    request.headers.get("if-none-match") === etag
  )
    return new Response(null, { status: 304, headers });
  if (download)
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(format === "mp3" ? version.filename.replace(/\.[^.]+$/, "") + ".mp3" : version.filename).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())}`,
    );
  let start = 0,
    end = size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!match[1]) start = Math.max(0, size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  if (download && !owner && request.method !== "HEAD" && start === 0) {
    const browser = z.uuid().safeParse(query.get("browser"));
    const session = z.uuid().safeParse(query.get("session"));
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
      versionId: version.id,
      linkId: link!.id,
      browser: browser.success ? browser.data : randomUUID(),
      session: session.success ? session.data : randomUUID(),
      kind: "download-started",
      name: previous?.name,
      context: {
        ...(await visitorContext(request, context?.referrer)),
        format,
      },
    });
  }
  headers.set("Content-Length", String(end - start + 1));
  return new Response(
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(
          createReadStream(path, { start, end }),
        ) as ReadableStream),
    { status, headers },
  );
}

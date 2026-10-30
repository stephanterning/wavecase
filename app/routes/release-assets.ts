import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../server/db";
import { releaseEvents } from "../server/schema";
import { directory, releaseAccess } from "../server/releases";
import { sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import { downloadRelease } from "../server/release-download";
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const form = await (await limitedBody(request, 8192)).formData();
  if (params.kind === "download")
    return downloadRelease(request, params.id!, form);
  if (params.kind !== "events")
    throw new Response("Not found", { status: 404 });
  const data = await releaseAccess(request, params.id!);
  if (!data.release.published || data.owner)
    return new Response(null, { status: 204 });
  const kind = z.enum(["visit", "play", "click"]).parse(form.get("kind"));
  let trackId: string | null = null;
  let detail: string | null = null;
  if (kind === "play") {
    const track = data.tracks.find(
      (t) => t.id === form.get("track") && t.original && t.playback,
    );
    if (!data.release.audioEnabled || !track)
      throw new Response("Audio unavailable", { status: 403 });
    trackId = track.id;
  }
  if (kind === "click") {
    const index = z.coerce.number().int().min(0).parse(form.get("link"));
    const link = data.release.links[index];
    if (!link) throw new Response("Link not found", { status: 404 });
    detail = `${link.label} | ${link.url}`;
  }
  await db
    .insert(releaseEvents)
    .values({
      id: z.uuid().parse(form.get("eventId")),
      releaseId: data.release.id,
      kind,
      trackId,
      detail,
    })
    .onConflictDoNothing();
  return new Response(null, { status: 204 });
}
export async function loader({ request, params }: LoaderFunctionArgs) {
  const data = await releaseAccess(request, params.id!);
  if (params.kind === "cover") {
    if (!data.release.cover) throw new Response("Not found", { status: 404 });
    return new Response(await readFile(join(directory(), data.release.cover)), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  if (params.kind !== "audio" || !data.release.audioEnabled)
    throw new Response("Audio unavailable", { status: 404 });
  const track = data.tracks.find(
    (t) => t.id === new URL(request.url).searchParams.get("track"),
  );
  if (!track?.playback)
    throw new Response("Audio unavailable", { status: 404 });
  const path = join(directory(), track.playback);
  const { size } = await stat(path);
  let start = 0,
    end = size - 1,
    status = 200;
  const headers = new Headers({
    "Content-Type": "audio/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const range = request.headers.get("range");
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    if (!m[1]) start = Math.max(0, size - Number(m[2]));
    else {
      start = Number(m[1]);
      if (m[2]) end = Math.min(end, Number(m[2]));
    }
    if (start > end || start >= size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
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

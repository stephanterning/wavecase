import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { downloadDemo } from "../server/demo-download";
import { sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
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
  if (download)
    throw new Response("Use the download dialog to request a ZIP.", {
      status: 405,
      headers: { Allow: "POST" },
    });
  const file = version.playback;
  if (!file || version.state !== "ready")
    throw new Response("Audio file missing", { status: 404 });
  const directory = process.env.DATA_DIR || "data/audio";
  const path = join(directory, file);
  const { size } = await stat(path);
  const headers = new Headers({
    "Content-Type": String(version.metadata?.mime || "audio/wav"),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  const etag = '"' + version.original + ":playback:" + size + '"';
  headers.set("ETag", etag);
  // Authorization runs before conditional responses so cached bytes never bypass a revoked link.
  if (
    !request.headers.has("range") &&
    request.headers.get("if-none-match") === etag
  )
    return new Response(null, { status: 304, headers });
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

export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const form = await (await limitedBody(request, 8192)).formData();
  return downloadDemo(request, params.id!, form);
}

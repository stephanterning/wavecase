import type { LoaderFunctionArgs } from "react-router";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { dataDir } from "../server/config";
import { hlsTokenPattern, hlsFilePattern } from "../server/hls";

// Only prepared playback assets are exposed. No listing, storage keys, source
// masters or mapping sidecars are reachable through this capability route.
export async function loader({ request, params }: LoaderFunctionArgs) {
  if (
    !hlsTokenPattern.test(params.token ?? "") ||
    !hlsFilePattern.test(params.file ?? "")
  )
    throw new Response("Not found", { status: 404 });
  const file = join(dataDir(), "hls", params.token!, params.file!);
  const info = await stat(file).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT")
      throw new Response("Not found", { status: 404 });
    throw error;
  });
  const headers = new Headers({
    "Content-Type": params.file!.endsWith(".m3u8")
      ? "application/vnd.apple.mpegurl"
      : "audio/mp4",
    "Cache-Control": "public, max-age=31536000, immutable",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
  });
  let start = 0,
    end = info.size - 1,
    status = 200;
  const range = request.headers.get("range");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    if (!match[1]) start = Math.max(0, info.size - Number(match[2]));
    else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (start > end || start >= info.size)
      return new Response(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${info.size}` },
      });
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${info.size}`);
  }
  headers.set("Content-Length", String(end - start + 1));
  return new Response(
    request.method === "HEAD"
      ? null
      : (Readable.toWeb(
          createReadStream(file, { start, end }),
        ) as ReadableStream),
    { status, headers },
  );
}

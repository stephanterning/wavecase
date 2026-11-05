import { hlsToken } from "./hls";

// Playback endpoints call this only after their normal access checks.
// Subsequent media requests use the unguessable capability, without sessions
// or DB queries.
export async function hlsRedirect(
  request: Request,
  directory: string,
  key: string,
) {
  const format = new URL(request.url).searchParams.get("hls") ?? "";
  if (!["flac", "aac", "master"].includes(format))
    throw new Response("Invalid format", { status: 400 });
  const token = await hlsToken(directory, key);
  if (!token)
    throw new Response("Preparing playback. Please try again shortly.", {
      status: 503,
      headers: { "Retry-After": "10", "Cache-Control": "private, no-store" },
    });
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/hls/${token}/${format}.m3u8`,
      "Cache-Control": "private, no-store",
    },
  });
}

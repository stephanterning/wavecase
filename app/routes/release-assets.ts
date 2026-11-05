import { hlsRedirect } from "../server/hls-access";
import { downloadDetails } from "../server/download-details";
import { rejectPreviewMutation } from "../server/preview";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../server/db";
import { releaseEvents } from "../server/schema";
import { directory, mediaArtwork, releaseAccess } from "../server/releases";
import { sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import { downloadRelease } from "../server/release-download";
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  rejectPreviewMutation(request);
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
  if (params.kind === "download-info") {
    if (
      !data.release.published ||
      !data.release.audioEnabled ||
      !data.release.cover
    )
      throw new Response("Downloads unavailable", { status: 403 });
    const selection = new URL(request.url).searchParams.get("track");
    const selected = data.tracks.filter(
      (t) => t.original && t.playback && (!selection || t.id === selection),
    );
    return Response.json(
      await downloadDetails(
        directory(),
        selected.map((t) => t.original!),
        data.release.cover,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  if (params.kind === "cover" || params.kind === "artwork.jpg") {
    if (!data.release.cover) throw new Response("Not found", { status: 404 });
    const thumbnail = params.kind === "artwork.jpg";
    const body = thumbnail
      ? await mediaArtwork(data.release.cover)
      : await readFile(join(directory(), data.release.cover));
    return new Response(request.method === "HEAD" ? null : body, {
      headers: {
        "Content-Type": thumbnail ? "image/jpeg" : "image/png",
        "Content-Length": String(body.length),
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
  return hlsRedirect(request, directory(), track.playback);
}

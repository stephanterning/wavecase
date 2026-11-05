import { hlsRedirect } from "../server/hls-access";
import { demoWavAvailable } from "../server/download";
import { downloadDetails } from "../server/download-details";
import { rejectPreviewMutation } from "../server/preview";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { downloadDemo } from "../server/demo-download";
import { sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import { versionAccess } from "../server/access";
import { dataDir } from "../server/config";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const query = new URL(request.url).searchParams;
  const { version, owner, link, track } = await versionAccess(
    request,
    params.id!,
    query.get("share") || undefined,
  );
  if (query.has("download-info")) {
    if (!owner && !(link?.download && version.download))
      throw new Response("Download unavailable", { status: 403 });
    if (!version.original || version.state !== "ready")
      throw new Response("Audio unavailable", { status: 404 });
    return Response.json(
      await downloadDetails(
        dataDir(),
        [version.original],
        track.cover,
        version.metadata?.audioPolicy !== 2,
        await demoWavAvailable(version, dataDir()),
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
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
  return hlsRedirect(request, dataDir(), file);
}

export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  rejectPreviewMutation(request);
  const form = await (await limitedBody(request, 8192)).formData();
  return downloadDemo(request, params.id!, form);
}

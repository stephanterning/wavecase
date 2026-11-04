import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { trackAccess } from "../server/access";
import { dataDir } from "../server/config";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const access = await trackAccess(
    request,
    params.id!,
    new URL(request.url).searchParams.get("share") || undefined,
  );
  if (!access.track.cover) throw new Response("Not found", { status: 404 });
  return new Response(await readFile(join(dataDir(), access.track.cover)), {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

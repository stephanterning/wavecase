import type { LoaderFunctionArgs } from "react-router";
import { trackPage } from "../server/track-page";

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { fingerprint } = await trackPage(request, params);
  return Response.json(
    { fingerprint },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

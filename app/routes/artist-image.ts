import type { LoaderFunctionArgs } from "react-router";
import { webArtwork } from "../server/artwork";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { artists } from "../server/schema";
import { directory } from "../server/releases";
export async function loader({ params }: LoaderFunctionArgs) {
  if (!z.uuid().safeParse(params.id).success)
    throw new Response("Not found", { status: 404 });
  const a = await db.query.artists.findFirst({
    where: eq(artists.id, params.id!),
  });
  if (!a?.image) throw new Response("Not found", { status: 404 });
  return new Response(await webArtwork(directory(), a.image), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

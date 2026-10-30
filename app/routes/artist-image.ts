import type { LoaderFunctionArgs } from "react-router";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
  return new Response(await readFile(join(directory(), a.image)), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

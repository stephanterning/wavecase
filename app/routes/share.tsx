export { loader, default } from "./track";
import type { ActionFunctionArgs } from "react-router";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { limitedBody } from "../server/request";
import { db } from "../server/db";
import { links, reuploadRequests } from "../server/schema";
import { sameOrigin } from "../server/security";
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const link = await db.query.links.findFirst({
    where: eq(links.id, params.share!),
  });
  if (!link?.active)
    throw new Response("This link is unavailable.", { status: 404 });
  const form = await (await limitedBody(request, 4096)).formData();
  const name =
    z
      .string()
      .trim()
      .max(100)
      .parse(form.get("name") || "") || null;
  await db
    .insert(reuploadRequests)
    .values({ linkId: link.id, trackId: link.trackId, name })
    .onConflictDoUpdate({
      target: reuploadRequests.linkId,
      set: { name: sql`coalesce(${name}, ${reuploadRequests.name})` },
    });
  return { requested: true };
}

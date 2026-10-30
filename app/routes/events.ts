import { visitorContext } from "../server/visitor";
import { limitedBody } from "../server/request";
import type { ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { db } from "../server/db";
import { events, links } from "../server/schema";
import { versionAccess, trackAccess } from "../server/access";
import { eq } from "drizzle-orm";
import { sameOrigin } from "../server/security";
const event = z.object({
  id: z.uuid().optional(),
  occurredAt: z.iso.datetime().optional(),
  referrer: z.string().max(2048).nullable().optional(),
  browser: z.uuid(),
  session: z.uuid(),
  name: z.string().max(100).nullable(),
  kind: z.enum(["visit", "play", "interval", "seek", "pause", "ended"]),
  position: z.number().min(0),
  end: z.number().min(0).optional(),
});
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const share =
    params.share || new URL(request.url).searchParams.get("share") || undefined;
  const visitLink = params.share
    ? await db.query.links.findFirst({ where: eq(links.id, params.share) })
    : null;
  if (params.share && !visitLink?.active)
    throw new Response("This link is unavailable.", { status: 404 });
  const access = visitLink
    ? {
        ...(await trackAccess(request, visitLink.trackId, visitLink.id)),
        version: null,
      }
    : await versionAccess(request, params.id!, share);
  if (access.owner) return new Response(null, { status: 204 });
  const body = event.parse(await (await limitedBody(request, 65536)).json());
  const version = access.version;
  if (
    (body.kind === "visit") !== !!visitLink ||
    (visitLink && (body.position !== 0 || body.end !== undefined))
  )
    throw new Response("Invalid event context", { status: 400 });
  if (
    body.position > (version?.duration || 0) + 1 ||
    (body.end !== undefined && body.end > (version?.duration || 0) + 1)
  )
    throw new Response("Invalid position", { status: 400 });
  if (
    body.kind === "interval" &&
    (body.end === undefined ||
      body.end < body.position ||
      body.end - body.position > 30)
  )
    throw new Response("Invalid interval", { status: 400 });
  const { referrer, occurredAt, ...values } = body;
  await db
    .insert(events)
    .values({
      ...values,
      createdAt: occurredAt ? new Date(occurredAt) : new Date(),
      versionId: version?.id || null,
      linkId: access.link!.id,
      context: await visitorContext(request, referrer),
    })
    .onConflictDoNothing({ target: events.id });
  return new Response(null, { status: 204 });
}

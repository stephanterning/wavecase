import { loader } from "./track";
export { loader, default } from "./track";
import type { ActionFunctionArgs, MetaFunction } from "react-router";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { limitedBody } from "../server/request";
import { db } from "../server/db";
import { links, reuploadRequests } from "../server/schema";
import { sameOrigin } from "../server/security";

export const meta: MetaFunction<typeof loader> = ({ loaderData: data, error }) => {
  if (error || !data?.shareUrl)
    return [{ title: "Wavecase" }, { name: "robots", content: "noindex" }];
  const { track, shareUrl, share } = data;
  const title = track.artist ? `${track.title} — ${track.artist}` : track.title;
  const description =
    track.description || "Listen and leave feedback on Wavecase.";
  const image = new URL(`/cover/${track.id}`, shareUrl);
  image.searchParams.set("share", share!);
  return [
    { title: `${title} · Wavecase` },
    { name: "robots", content: "noindex" },
    { name: "description", content: description },
    { property: "og:site_name", content: "Wavecase" },
    { property: "og:type", content: "website" },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:url", content: shareUrl },
    ...(track.cover
      ? [
          { property: "og:image", content: image.href },
          { property: "og:image:alt", content: `Cover for ${track.title}` },
        ]
      : []),
  ];
};

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

import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { versions } from "./schema";

export async function shareVersionScope(
  trackId: string,
  visibility: FormDataEntryValue | null,
  versionId: FormDataEntryValue | null,
) {
  const mode = z.enum(["all", "onward", "single"]).parse(visibility);
  if (mode === "all") return { fromOrder: null, pinnedOrder: null };
  if (mode === "single" && !versionId)
    throw new Response("Choose a version to share.", { status: 400 });
  const version = await db.query.versions.findFirst({
    where: and(
      eq(versions.trackId, trackId),
      inArray(versions.state, ["ready", "missing"]),
      versionId ? eq(versions.id, z.uuid().parse(versionId)) : undefined,
    ),
    orderBy: desc(versions.position),
  });
  if (!version)
    throw new Response(
      versionId
        ? "Choose a published version of this track."
        : "Publish a version before creating a latest-and-future link.",
      { status: 400 },
    );
  return {
    fromOrder: mode === "onward" ? version.position : null,
    pinnedOrder: mode === "single" ? version.position : null,
  };
}

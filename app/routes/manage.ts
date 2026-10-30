import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ActionFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { eq, and, sql, inArray } from "drizzle-orm";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../server/db";
import {
  tracks,
  versions,
  links,
  events,
  reuploadRequests,
} from "../server/schema";
import { trackAccess } from "../server/access";
import { sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import { boss, queue } from "../server/queue";
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const access = await trackAccess(request, params.id!);
  if (!access.owner) throw new Response("Forbidden", { status: 403 });
  const form = await (
    await limitedBody(
      request,
      Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
    )
  ).formData();
  const intent = form.get("intent");
  const removedFiles: string[] = [];
  const directory = process.env.DATA_DIR || "data/audio";
  if (intent === "dismiss-request") {
    await db
      .delete(reuploadRequests)
      .where(
        and(
          eq(reuploadRequests.trackId, access.track.id),
          eq(reuploadRequests.linkId, String(form.get("link"))),
        ),
      );
  } else if (intent === "remove-track") {
    await db.transaction(async (tx) => {
      const all = await tx
        .select()
        .from(versions)
        .where(eq(versions.trackId, access.track.id))
        .for("update");
      await tx
        .update(versions)
        .set({
          state: "missing",
          original: null,
          playback: null,
          pendingOriginal: null,
          pendingFilename: null,
          error: null,
        })
        .where(eq(versions.trackId, access.track.id));
      for (const version of all)
        removedFiles.push(
          ...[
            version.original,
            version.playback,
            version.pendingOriginal,
          ].filter((p): p is string => !!p),
        );
    });
  } else if (intent === "cover") {
    const file = form.get("cover");
    if (!(file instanceof File) || !file.size || file.size > 10 * 1024 * 1024)
      throw new Response("Choose an image up to 10 MB", { status: 400 });
    const key = randomUUID(),
      input = join(directory, key),
      output = join(directory, key + ".jpg");
    await mkdir(directory, { recursive: true });
    await writeFile(input, Buffer.from(await file.arrayBuffer()));
    try {
      await promisify(execFile)(
        "ffmpeg",
        [
          "-nostdin",
          "-y",
          "-v",
          "error",
          "-protocol_whitelist",
          "file",
          "-format_whitelist",
          "png_pipe,jpeg_pipe,webp_pipe,image2",
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          "scale=512:512:force_original_aspect_ratio=decrease",
          output,
        ],
        { timeout: 30000 },
      );
      await db
        .update(tracks)
        .set({ cover: key + ".jpg" })
        .where(eq(tracks.id, access.track.id));
      if (access.track.cover) removedFiles.push(access.track.cover);
    } finally {
      await unlink(input).catch(() => {});
    }
  } else if (intent === "metadata") {
    await db
      .update(tracks)
      .set({
        title: z.string().trim().min(1).max(200).parse(form.get("title")),
        artist: String(form.get("artist") || "").slice(0, 200),
        description: String(form.get("description") || "").slice(0, 5000),
      })
      .where(eq(tracks.id, access.track.id));
  } else if (intent === "link") {
    let fromOrder: number | null = null;
    if (form.get("from")) {
      const version = await db.query.versions.findFirst({
        where: and(
          eq(versions.id, z.uuid().parse(form.get("from"))),
          eq(versions.trackId, access.track.id),
        ),
      });
      if (!version) throw new Response("Invalid version", { status: 400 });
      fromOrder = version.position;
    }
    await db
      .update(links)
      .set({
        label: String(form.get("label") || "Shared link").slice(0, 200),
        active: form.has("active"),
        download: form.has("download"),
        fromOrder,
      })
      .where(
        and(
          eq(links.id, String(form.get("link"))),
          eq(links.trackId, access.track.id),
        ),
      );
  } else if (intent === "clear-analytics") {
    await db
      .delete(events)
      .where(
        inArray(
          events.linkId,
          db
            .select({ id: links.id })
            .from(links)
            .where(eq(links.trackId, access.track.id)),
        ),
      );
  } else {
    const id = z.uuid().parse(form.get("version"));
    await db.transaction(async (tx) => {
      await tx.execute(sql`select id from versions where id=${id} for update`);
      const version = await tx.query.versions.findFirst({
        where: and(eq(versions.id, id), eq(versions.trackId, access.track.id)),
      });
      if (!version) throw new Response("Not found", { status: 404 });
      if (intent === "remove") {
        await tx
          .update(versions)
          .set({
            state: "missing",
            original: null,
            playback: null,
            pendingOriginal: null,
            pendingFilename: null,
            error: null,
          })
          .where(eq(versions.id, id));
        removedFiles.push(
          ...[
            ...new Set([
              version.original,
              version.playback,
              version.pendingOriginal,
            ]),
          ].filter((p): p is string => !!p),
        );
      } else if (intent === "version") {
        await tx
          .update(versions)
          .set({
            name: z.string().trim().min(1).max(100).parse(form.get("name")),
            description: String(form.get("description") || "").slice(0, 5000),
            status: z
              .enum([
                "early idea",
                "work in progress",
                "almost finished",
                "finished",
              ])
              .parse(form.get("status")),
            download: form.has("download"),
          })
          .where(eq(versions.id, id));
      } else if (intent === "replace") {
        if (version.pendingOriginal)
          throw new Response("This version is already processing an upload", {
            status: 409,
          });
        const file = form.get("audio");
        if (!(file instanceof File) || !file.size)
          throw new Response("Choose an audio file", { status: 400 });
        const key = randomUUID();
        await mkdir(directory, { recursive: true });
        await writeFile(
          join(directory, key),
          Buffer.from(await file.arrayBuffer()),
        );
        await tx
          .update(versions)
          .set({
            pendingOriginal: key,
            pendingFilename: file.name,
            error: null,
          })
          .where(eq(versions.id, id));
      } else throw new Response("Unknown action", { status: 400 });
    });
    if (intent === "replace") {
      await queue();
      await boss.send(
        "process-audio",
        { versionId: id },
        { singletonKey: id, retryLimit: 3, retryDelay: 10 },
      );
    }
  }
  await Promise.all(
    removedFiles.map((p) => unlink(join(directory, p)).catch(() => {})),
  );
  return redirect("/tracks/" + access.track.id);
}

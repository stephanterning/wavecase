import { versionStatuses } from "../domain/versions";
import { shareVersionScope } from "../server/share-links";
import {
  deleteDemo,
  deleteDemoVersion,
  deleteShareLink,
} from "../server/delete-demo";
import { formError } from "../server/releases";
import { resolveTrackArtist } from "../server/track-artist";
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
import { artistScope, trackScope } from "../server/ownership";
import { trackAccess } from "../server/access";
import { sameOrigin, requireUser } from "../server/security";
import { limitedBody } from "../server/request";
import { removeAudioFiles } from "../server/audio-files";
import { boss, queue } from "../server/queue";
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const access = await trackAccess(request, params.id!);
  if (!access.owner) throw new Response("Forbidden", { status: 403 });
  const form = await (
    await limitedBody(
      request,
      Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
    )
  ).formData();
  try {
    const intent = form.get("intent");
    const removedFiles: string[] = [];
    const directory = process.env.DATA_DIR || "data/audio";
    if (intent === "delete-track") {
      await deleteDemo(
        access.track.id,
        user.id,
        String(form.get("confirmation") || ""),
      );
      return redirect("/library");
    } else if (intent === "delete-version") {
      await deleteDemoVersion(
        access.track.id,
        z.uuid().parse(form.get("version")),
        user.id,
        String(form.get("confirmation") || ""),
      );
    } else if (intent === "delete-link") {
      if (form.get("confirm") !== "delete")
        throw new Response("Confirm link deletion.", { status: 400 });
      await deleteShareLink(access.track.id, String(form.get("link") || ""));
    } else if (intent === "dismiss-request") {
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
            pendingUploadedAt: null,
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
    } else if (intent === "remove-cover") {
      await db.transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(tracks)
          .where(eq(tracks.id, access.track.id))
          .for("update");
        if (!current) throw new Response("Not found", { status: 404 });
        await tx
          .update(tracks)
          .set({ cover: null })
          .where(eq(tracks.id, current.id));
        if (current.cover) removedFiles.push(current.cover);
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
        await db.transaction(async (tx) => {
          const [current] = await tx
            .select()
            .from(tracks)
            .where(eq(tracks.id, access.track.id))
            .for("update");
          if (!current) throw new Response("Not found", { status: 404 });
          await tx
            .update(tracks)
            .set({ cover: key + ".jpg" })
            .where(eq(tracks.id, current.id));
          if (current.cover) removedFiles.push(current.cover);
        });
      } catch (error) {
        await unlink(output).catch(() => {});
        throw error;
      } finally {
        await unlink(input).catch(() => {});
      }
    } else if (intent === "metadata") {
      const field = z
        .enum(["title", "artist", "description", "all"])
        .parse(form.get("field") || "all");
      const artist =
        field === "artist" || field === "all"
          ? await resolveTrackArtist(user.id, form, access.track)
          : null;
      if (
        artist &&
        artist.artistId !== access.track.artistId &&
        form.get("confirmArtistMove") !== "yes"
      )
        throw new Response(
          "Confirm the artist change: access changes and all versions, discussions, links and statistics move with the demo.",
          { status: 400 },
        );
      const [saved] = await db
        .update(tracks)
        .set({
          ...(field === "title" || field === "all"
            ? {
                title: z
                  .string()
                  .trim()
                  .min(1)
                  .max(200)
                  .parse(form.get("title")),
              }
            : {}),
          ...(artist
            ? {
                ...artist,
                ...(artist.artistId !== access.track.artistId
                  ? { ownerId: user.id }
                  : {}),
              }
            : {}),
          ...(field === "description" || field === "all"
            ? {
                description: String(form.get("description") || "").slice(
                  0,
                  5000,
                ),
              }
            : {}),
        })
        .where(
          and(
            eq(tracks.id, access.track.id),
            trackScope(user.id),
            sql`${tracks.artistId} is not distinct from ${access.track.artistId}::uuid`,
            artist?.artistId
              ? artistScope(user.id, sql`${artist.artistId}::uuid`)
              : undefined,
          ),
        )
        .returning({ id: tracks.id });
      if (!saved)
        throw new Response(
          "Artist access changed. Reload the demo before saving.",
          { status: 409 },
        );
    } else if (intent === "link") {
      const scope =
        form.get("from") === "unchanged"
          ? {}
          : await shareVersionScope(
              access.track.id,
              form.get("visibility") || (form.get("from") ? "onward" : "all"),
              form.get("from"),
            );
      await db
        .update(links)
        .set({
          label: String(form.get("label") || "Shared link").slice(0, 200),
          active: form.has("active"),
          download: form.has("download"),
          ...scope,
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
        await tx.execute(
          sql`select id from versions where id=${id} for update`,
        );
        const version = await tx.query.versions.findFirst({
          where: and(
            eq(versions.id, id),
            eq(versions.trackId, access.track.id),
          ),
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
              pendingUploadedAt: null,
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
          const field = z
            .enum(["name", "description", "settings", "all"])
            .parse(form.get("field") || "all");
          await tx
            .update(versions)
            .set({
              ...(field === "name" || field === "all"
                ? {
                    name: z
                      .string()
                      .trim()
                      .min(1)
                      .max(100)
                      .parse(form.get("name")),
                  }
                : {}),
              ...(field === "description" || field === "all"
                ? {
                    description: String(form.get("description") || "").slice(
                      0,
                      5000,
                    ),
                  }
                : {}),
              ...(field === "settings" || field === "all"
                ? {
                    status: z.enum(versionStatuses).parse(form.get("status")),
                    download: form.has("download"),
                  }
                : {}),
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
              pendingUploadedAt: new Date(),
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
    await removeAudioFiles(directory, removedFiles);
    if (form.has("_inline")) return { saved: true };
    return redirect("/tracks/" + access.track.id);
  } catch (error) {
    if (form.has("_inline")) return formError(error);
    throw error;
  }
}

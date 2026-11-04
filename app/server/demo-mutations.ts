import { execFile } from "node:child_process";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { and, eq, inArray, sql } from "drizzle-orm";
import { data, redirect, type ActionFunctionArgs } from "react-router";
import { z } from "zod";
import { versionStatuses } from "../domain/versions";
import { trackAccess } from "./access";
import { removeAudioFiles } from "./audio-files";
import { dataDir, maxUploadBytes } from "./config";
import { db } from "./db";
import { deleteDemo, deleteDemoVersion, deleteShareLink } from "./delete-demo";
import { artistScope, trackScope } from "./ownership";
import { boss, queue } from "./queue";
import { formError } from "./releases";
import { storeUpload, uploadForm, type Upload } from "./request";
import { events, links, reuploadRequests, tracks, versions } from "./schema";
import { requireUser, sameOrigin, token } from "./security";
import { shareVersionScope } from "./share-links";
import { resolveTrackArtist } from "./track-artist";
import { uploadVersion } from "./upload";

type Context = {
  user: Awaited<ReturnType<typeof requireUser>>;
  track: Awaited<ReturnType<typeof trackAccess>>["track"];
  form: FormData;
  files: Map<string, Upload>;
};
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function intent<Schema extends z.ZodType>(
  schema: Schema,
  handle: (input: z.output<Schema>, context: Context) => Promise<object | void>,
) {
  return (context: Context) =>
    handle(schema.parse(Object.fromEntries(context.form)), context);
}

const text = (max: number, fallback = "") =>
  z
    .string()
    .optional()
    .transform((value) => (value || fallback).slice(0, max));
const checkbox = z
  .string()
  .optional()
  .transform((value) => value !== undefined);

async function lockVersion(tx: Transaction, trackId: string, id: string) {
  await tx.execute(
    sql`select id from versions where id=${id} for no key update`,
  );
  const version = await tx.query.versions.findFirst({
    where: and(eq(versions.id, id), eq(versions.trackId, trackId)),
  });
  if (!version) throw new Response("Not found", { status: 404 });
  return version;
}

async function lockTrack(tx: Transaction, trackId: string) {
  const [current] = await tx
    .select()
    .from(tracks)
    .where(eq(tracks.id, trackId))
    .for("no key update");
  if (!current) throw new Response("Not found", { status: 404 });
  return current;
}

const mutations: Record<string, (context: Context) => Promise<object | void>> =
  {
    "delete-track": intent(
      z.object({ confirmation: z.string().default("") }),
      async ({ confirmation }, { track, user }) => {
        await deleteDemo(track.id, user.id, confirmation);
        return redirect("/library");
      },
    ),
    "delete-version": intent(
      z.object({ version: z.uuid(), confirmation: z.string().default("") }),
      async ({ version, confirmation }, { track, user }) => {
        await deleteDemoVersion(track.id, version, user.id, confirmation);
      },
    ),
    "create-link": intent(
      z.object({
        label: text(200, "Shared link"),
        download: checkbox,
        visibility: z.string().optional(),
        from: z.string().optional(),
      }),
      async ({ label, download, visibility, from }, { track }) => {
        const scope = await shareVersionScope(
          track.id,
          visibility || "onward",
          from ?? null,
        );
        await db.insert(links).values({
          id: token(),
          trackId: track.id,
          label,
          download,
          ...scope,
        });
      },
    ),
    link: intent(
      z.object({
        link: z.string(),
        label: text(200, "Shared link"),
        active: checkbox,
        download: checkbox,
        visibility: z.string().optional(),
        from: z.string().optional(),
      }),
      async (
        { link, label, active, download, visibility, from },
        { track },
      ) => {
        const scope =
          from === "unchanged"
            ? {}
            : await shareVersionScope(
                track.id,
                visibility || (from ? "onward" : "all"),
                from ?? null,
              );
        await db
          .update(links)
          .set({ label, active, download, ...scope })
          .where(and(eq(links.id, link), eq(links.trackId, track.id)));
      },
    ),
    "delete-link": intent(
      z.object({
        confirm: z.literal("delete", { error: "Confirm link deletion." }),
        link: z.string().default(""),
      }),
      async ({ link }, { track }) => {
        await deleteShareLink(track.id, link);
      },
    ),
    "dismiss-request": intent(
      z.object({ link: z.string() }),
      async ({ link }, { track }) => {
        await db
          .delete(reuploadRequests)
          .where(
            and(
              eq(reuploadRequests.trackId, track.id),
              eq(reuploadRequests.linkId, link),
            ),
          );
      },
    ),
    "clear-analytics": intent(z.object({}), async (_, { track }) => {
      await db
        .delete(events)
        .where(
          inArray(
            events.linkId,
            db
              .select({ id: links.id })
              .from(links)
              .where(eq(links.trackId, track.id)),
          ),
        );
    }),
    metadata: intent(
      z.object({
        field: z.enum(["title", "artist", "description", "all"]).default("all"),
        title: z.string().optional(),
        description: text(5000),
        confirmArtistMove: z.string().optional(),
      }),
      async (
        { field, title, description, confirmArtistMove },
        { user, track, form },
      ) => {
        const artist =
          field === "artist" || field === "all"
            ? await resolveTrackArtist(user.id, form, track)
            : null;
        if (
          artist &&
          artist.artistId !== track.artistId &&
          confirmArtistMove !== "yes"
        )
          throw new Response(
            "Confirm the artist change: access changes and all versions, discussions, links and statistics move with the demo.",
            { status: 400 },
          );
        const [saved] = await db
          .update(tracks)
          .set({
            ...(field === "title" || field === "all"
              ? { title: z.string().trim().min(1).max(200).parse(title) }
              : {}),
            ...(artist
              ? {
                  ...artist,
                  ...(artist.artistId !== track.artistId
                    ? { ownerId: user.id }
                    : {}),
                }
              : {}),
            ...(field === "description" || field === "all"
              ? { description }
              : {}),
          })
          .where(
            and(
              eq(tracks.id, track.id),
              trackScope(user.id),
              sql`${tracks.artistId} is not distinct from ${track.artistId}::uuid`,
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
      },
    ),
    cover: intent(z.object({}), async (_, { track, files }) => {
      const file = files.get("cover");
      if (!file)
        throw new Response("Choose an image up to 10 MB", { status: 400 });
      const key = await storeUpload(file, {
        limit: 10 * 1024 * 1024,
        error: "Choose an image up to 10 MB",
      });
      const input = join(dataDir(), key),
        output = join(dataDir(), key + ".jpg");
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
        const previous = await db.transaction(async (tx) => {
          const current = await lockTrack(tx, track.id);
          await tx
            .update(tracks)
            .set({ cover: key + ".jpg" })
            .where(eq(tracks.id, current.id));
          return current.cover;
        });
        await removeAudioFiles(dataDir(), [previous]);
      } catch (error) {
        await unlink(output).catch(() => {});
        throw error;
      } finally {
        await unlink(input).catch(() => {});
      }
    }),
    "remove-cover": intent(z.object({}), async (_, { track }) => {
      const previous = await db.transaction(async (tx) => {
        const current = await lockTrack(tx, track.id);
        await tx
          .update(tracks)
          .set({ cover: null })
          .where(eq(tracks.id, current.id));
        return current.cover;
      });
      await removeAudioFiles(dataDir(), [previous]);
    }),
    "upload-version": intent(
      z.object({}),
      async (_, { track, form, files }) => ({
        ok: true,
        version: await uploadVersion(track.id, form, files.get("audio")),
      }),
    ),
    version: intent(
      z.object({
        version: z.uuid(),
        field: z
          .enum(["name", "description", "settings", "all"])
          .default("all"),
        name: z.string().optional(),
        description: text(5000),
        status: z.string().optional(),
        download: checkbox,
      }),
      async (
        { version: id, field, name, description, status, download },
        { track },
      ) => {
        await db.transaction(async (tx) => {
          await lockVersion(tx, track.id, id);
          await tx
            .update(versions)
            .set({
              ...(field === "name" || field === "all"
                ? { name: z.string().trim().min(1).max(100).parse(name) }
                : {}),
              ...(field === "description" || field === "all"
                ? { description }
                : {}),
              ...(field === "settings" || field === "all"
                ? { status: z.enum(versionStatuses).parse(status), download }
                : {}),
            })
            .where(eq(versions.id, id));
        });
      },
    ),
    remove: intent(
      z.object({ version: z.uuid() }),
      async ({ version: id }, { track }) => {
        const removed = await db.transaction(async (tx) => {
          const version = await lockVersion(tx, track.id, id);
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
          return [version.original, version.playback, version.pendingOriginal];
        });
        await removeAudioFiles(dataDir(), removed);
      },
    ),
    replace: intent(
      z.object({ version: z.uuid() }),
      async ({ version: id }, { track, files }) => {
        const file = files.get("audio");
        if (!file) throw new Response("Choose an audio file", { status: 400 });
        const key = await storeUpload(file, {
          limit: maxUploadBytes(),
          error: "Choose an audio file",
        });
        await db
          .transaction(async (tx) => {
            const version = await lockVersion(tx, track.id, id);
            if (version.pendingOriginal)
              throw new Response(
                "This version is already processing an upload",
                {
                  status: 409,
                },
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
          })
          .catch(async (error) => {
            await unlink(join(dataDir(), key)).catch(() => {});
            throw error;
          });
        await queue();
        await boss.send(
          "process-audio",
          { versionId: id },
          { singletonKey: id, retryLimit: 3, retryDelay: 10 },
        );
      },
    ),
  };

export async function demoMutation({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const { owner, track } = await trackAccess(request, params.id!);
  if (!owner) throw new Response("Forbidden", { status: 403 });
  const { form, files, discard } = await uploadForm(
    request,
    maxUploadBytes() + 65536,
  );
  try {
    const name = String(form.get("intent"));
    if (!Object.hasOwn(mutations, name))
      throw new Response("Unknown action", { status: 400 });
    return (
      (await mutations[name]({ user, track, form, files })) ?? { saved: true }
    );
  } catch (error) {
    return data(await formError(error), {
      status: error instanceof Response ? error.status : 400,
    });
  } finally {
    await discard();
  }
}

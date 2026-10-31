import { releasePath } from "../domain/releases";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useRevalidator,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { useEffect } from "react";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../server/db";
import { releases, releaseTracks, releaseEvents } from "../server/schema";
import { sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import {
  directory,
  formError,
  releaseAccess,
  storeArtwork,
  storeFile,
} from "../server/releases";
import { releaseFields, trackFields, parseLinks } from "../domain/releases";
import { boss, queue } from "../server/queue";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const data = await releaseAccess(request, params.id!, true);
  const page = Math.max(
    0,
    Math.min(
      1000000,
      Number(new URL(request.url).searchParams.get("page")) || 0,
    ),
  );
  return {
    ...data,
    page,
    stats: await db
      .select({
        kind: releaseEvents.kind,
        trackId: releaseEvents.trackId,
        detail: releaseEvents.detail,
        count: sql<number>`count(*)::int`,
      })
      .from(releaseEvents)
      .where(
        and(
          eq(releaseEvents.releaseId, data.release.id),
          sql`${releaseEvents.kind} <> 'download-started'`,
        ),
      )
      .groupBy(releaseEvents.kind, releaseEvents.trackId, releaseEvents.detail),
    downloads: await db
      .select()
      .from(releaseEvents)
      .where(
        and(
          eq(releaseEvents.releaseId, data.release.id),
          eq(releaseEvents.kind, "download-started"),
        ),
      )
      .orderBy(desc(releaseEvents.createdAt))
      .limit(50)
      .offset(Math.floor(page) * 50),
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const data = await releaseAccess(request, params.id!, true);
  try {
    const f = await (
      await limitedBody(
        request,
        Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
      )
    ).formData();
    const intent = f.get("intent");
    const removedFiles: string[] = [];
    const metadata = (fields: readonly string[]) =>
      Object.fromEntries(
        fields.map((key) => [
          key,
          z
            .string()
            .trim()
            .max(5000)
            .parse(f.get(key) || ""),
        ]),
      );
    if (intent === "metadata") {
      const meta = metadata(releaseFields);
      if (meta.releaseDate && !z.iso.date().safeParse(meta.releaseDate).success)
        throw new Response("Enter a valid release date.", { status: 400 });
      await db
        .update(releases)
        .set({
          title: z.string().trim().min(1).max(200).parse(f.get("title")),
          kind: z.enum(["single", "ep", "album"]).parse(f.get("kind")),
          description: z.string().max(5000).parse(f.get("description")),
          metadata: meta,
          links: parseLinks(String(f.get("links") || "")),
          audioEnabled: f.has("audioEnabled"),
        })
        .where(eq(releases.id, data.release.id));
    } else if (intent === "publish") {
      if (!data.release.cover)
        throw new Response("Upload artwork before publishing.", {
          status: 400,
        });
      if (!data.tracks.length)
        throw new Response(
          "Add at least one track before publishing. Audio is optional.",
          { status: 400 },
        );
      await db
        .update(releases)
        .set({ published: true })
        .where(eq(releases.id, data.release.id));
    } else if (intent === "unpublish") {
      await db
        .update(releases)
        .set({ published: false })
        .where(eq(releases.id, data.release.id));
    } else if (intent === "cover") {
      const file = f.get("cover");
      if (!(file instanceof File))
        throw new Response("Choose artwork", { status: 400 });
      const key = await storeArtwork(file);
      if (data.release.cover) removedFiles.push(data.release.cover);
      await db
        .update(releases)
        .set({ cover: key })
        .where(eq(releases.id, data.release.id));
    } else if (intent === "add-track") {
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(releases)
          .where(eq(releases.id, data.release.id))
          .for("update");
        const rows = await tx
          .select()
          .from(releaseTracks)
          .where(eq(releaseTracks.releaseId, data.release.id));
        await tx.insert(releaseTracks).values({
          releaseId: data.release.id,
          title: z.string().trim().min(1).max(200).parse(f.get("title")),
          position: Math.max(0, ...rows.map((t) => t.position)) + 1,
        });
      });
    } else {
      const id = z.uuid().parse(f.get("track"));
      await db.transaction(async (tx) => {
        await tx
          .select()
          .from(releases)
          .where(eq(releases.id, data.release.id))
          .for("update");
        const [track] = await tx
          .select()
          .from(releaseTracks)
          .where(
            and(
              eq(releaseTracks.id, id),
              eq(releaseTracks.releaseId, data.release.id),
            ),
          )
          .for("update");
        if (!track) throw new Response("Track not found", { status: 404 });
        if (intent === "track") {
          const position = z.coerce
            .number()
            .int()
            .min(1)
            .max(999)
            .parse(f.get("position"));
          if (position !== track.position)
            await tx
              .update(releaseTracks)
              .set({ position: track.position })
              .where(
                and(
                  eq(releaseTracks.releaseId, data.release.id),
                  eq(releaseTracks.position, position),
                ),
              );
          await tx
            .update(releaseTracks)
            .set({
              title: z.string().trim().min(1).max(200).parse(f.get("title")),
              position,
              metadata: {
                ...metadata(trackFields),
                explicit: f.has("explicit"),
              },
            })
            .where(eq(releaseTracks.id, id));
        } else if (intent === "audio") {
          if (track.pendingOriginal)
            throw new Response("This track already has an upload processing.", {
              status: 409,
            });
          const file = f.get("audio");
          if (!(file instanceof File))
            throw new Response("Choose a WAV file", { status: 400 });
          const key = await storeFile(
            file,
            Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024,
          );
          try {
            await tx
              .update(releaseTracks)
              .set({ pendingOriginal: key, error: null })
              .where(eq(releaseTracks.id, id));
          } catch (error) {
            await unlink(join(directory(), key)).catch(() => {});
            throw error;
          }
        } else if (intent === "remove-audio") {
          removedFiles.push(
            ...[track.original, track.playback, track.pendingOriginal].filter(
              (p): p is string => !!p,
            ),
          );
          await tx
            .update(releaseTracks)
            .set({
              original: null,
              playback: null,
              audioMeasurements: null,
              pendingOriginal: null,
              duration: null,
              sampleRate: null,
              bitDepth: null,
              error: null,
            })
            .where(eq(releaseTracks.id, id));
        } else throw new Response("Unknown action", { status: 400 });
      });
      if (intent === "audio") {
        try {
          await queue();
          await boss.send(
            "process-release",
            { trackId: id },
            { singletonKey: id, retryLimit: 3, retryDelay: 10 },
          );
        } catch {
          console.error("Release upload retained for worker reconciliation");
        }
      }
    }
    await Promise.all(
      removedFiles.map((p) => unlink(join(directory(), p)).catch(() => {})),
    );
    return redirect(`/releases/${data.release.id}`);
  } catch (error) {
    return formError(error);
  }
}
function Fields({
  fields,
  values,
}: {
  fields: readonly string[];
  values: Record<string, unknown>;
}) {
  return (
    <div className="release-fields">
      {fields.map((field) => (
        <label key={field}>
          {field
            .replace(/([A-Z])/g, " $1")
            .replace(/^./, (s) => s.toUpperCase())}
          {field === "songwriters" && (
            <small>Separate names with commas or semicolons.</small>
          )}
          {field === "credits" ? (
            <textarea
              name={field}
              defaultValue={String(values[field] || "")}
              maxLength={5000}
            />
          ) : (
            <input
              type={field === "releaseDate" ? "date" : "text"}
              name={field}
              defaultValue={String(values[field] || "")}
              maxLength={5000}
            />
          )}
        </label>
      ))}
    </div>
  );
}
export default function ReleaseEditor() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const revalidator = useRevalidator();
  const pending = d.tracks.some((t) => t.pendingOriginal);
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [pending, revalidator]);
  return (
    <>
      <nav>
        <a href="/releases">Artists & releases</a> ·{" "}
        <a href={releasePath(d.artist, d.release)}>Preview public page</a>
      </nav>
      <p className="eyebrow">
        {d.release.published ? "PUBLISHED" : "PRIVATE DRAFT"} · {d.artist.name}
      </p>
      <h1>{d.release.title}</h1>
      {result?.error && <p role="alert">{result.error}</p>}
      <Form method="post">
        <button
          name="intent"
          value={d.release.published ? "unpublish" : "publish"}
        >
          {d.release.published ? "Unpublish" : "Publish release"}
        </button>
      </Form>
      <p className="muted">
        Published edits become visible when saved. The public address stays the
        same.
      </p>
      <Form method="post" className="panel" key={d.release.id}>
        <input type="hidden" name="intent" value="metadata" />
        <h2>Release details</h2>
        <label>
          Title
          <input
            name="title"
            required
            defaultValue={d.release.title}
            maxLength={200}
          />
        </label>
        <label>
          Type
          <select name="kind" defaultValue={d.release.kind}>
            <option value="single">Single</option>
            <option value="ep">EP</option>
            <option value="album">Album</option>
          </select>
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={d.release.description}
            maxLength={5000}
          />
        </label>
        <Fields fields={releaseFields} values={d.release.metadata} />
        <label>
          Streaming and shop links (one per line: Label | https://...)
          <textarea
            name="links"
            defaultValue={d.release.links
              .map((l) => `${l.label} | ${l.url}`)
              .join("\n")}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="audioEnabled"
            defaultChecked={d.release.audioEnabled}
          />
          Enable playback and email-gated downloads together
        </label>
        <button>Save release</button>
      </Form>
      <Form method="post" encType="multipart/form-data" className="panel">
        <input type="hidden" name="intent" value="cover" />
        <h2>Artwork</h2>
        {d.release.cover && (
          <img
            className="release-thumb"
            src={`/release-assets/${d.release.id}/cover`}
            alt="Release artwork"
          />
        )}
        <label>
          PNG, JPG or WebP, up to 10 MB
          <input
            name="cover"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
          />
        </label>
        <button>Upload artwork</button>
      </Form>
      <h2>Track list</h2>
      {d.tracks.map((t) => (
        <section className="panel" key={t.id}>
          <Form method="post">
            <input type="hidden" name="intent" value="track" />
            <input type="hidden" name="track" value={t.id} />
            <label>
              Track number
              <input
                type="number"
                name="position"
                min={1}
                max={999}
                required
                defaultValue={t.position}
              />
            </label>
            <label>
              Title
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={t.title}
              />
            </label>
            <Fields fields={trackFields} values={t.metadata} />
            <label className="check">
              <input
                type="checkbox"
                name="explicit"
                defaultChecked={t.metadata.explicit}
              />
              Explicit
            </label>
            <button>Save track</button>
          </Form>
          <p>
            {t.original
              ? `WAV · ${t.bitDepth} bit · ${t.sampleRate} Hz`
              : "No audio uploaded"}
            {t.pendingOriginal && " · Processing upload…"}
          </p>
          {t.original && (t.bitDepth !== 24 || t.sampleRate !== 48000) && (
            <p className="muted">
              24-bit / 48 kHz is preferred. This master will be downloaded
              unchanged.
            </p>
          )}
          {t.error && <p role="alert">{t.error}</p>}
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="audio" />
            <input type="hidden" name="track" value={t.id} />
            <label>
              Master WAV (24-bit / 48 kHz preferred)
              <input
                name="audio"
                type="file"
                accept=".wav,audio/wav"
                required
                disabled={!!t.pendingOriginal}
              />
            </label>
            <button disabled={!!t.pendingOriginal}>
              {t.original ? "Replace master" : "Upload master"}
            </button>
          </Form>
          {(t.original || t.pendingOriginal) && (
            <Form method="post">
              <input type="hidden" name="track" value={t.id} />
              <button name="intent" value="remove-audio">
                Remove audio
              </button>
            </Form>
          )}
        </section>
      ))}
      <Form method="post" className="panel">
        <input type="hidden" name="intent" value="add-track" />
        <label>
          New track title
          <input name="title" required maxLength={200} />
        </label>
        <button>Add track</button>
        <p>
          Audio is optional. Add all tracks, including those without
          downloadable audio.
        </p>
      </Form>
      <section className="panel">
        <h2>Release activity</h2>
        {d.stats.length ? (
          <ul>
            {d.stats.map((s, i) => (
              <li key={i}>
                {s.kind}
                {s.trackId
                  ? ` · ${d.tracks.find((t) => t.id === s.trackId)?.title}`
                  : ""}
                {s.detail ? ` · ${s.detail}` : ""}: {s.count}
              </li>
            ))}
          </ul>
        ) : (
          <p>No visits, plays or link clicks yet.</p>
        )}
        <h3>Download requests</h3>
        <p>
          Addresses are self-reported. A request does not confirm transfer
          completion.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Email</th>
                <th>Package contents</th>
              </tr>
            </thead>
            <tbody>
              {d.downloads.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.createdAt).toISOString()}</td>
                  <td>{e.email}</td>
                  <td>{e.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {d.page > 0 && <a href={`?page=${d.page - 1}`}>Newer requests</a>}
        {d.downloads.length === 50 && (
          <a href={`?page=${d.page + 1}`}>Older requests</a>
        )}
      </section>
    </>
  );
}

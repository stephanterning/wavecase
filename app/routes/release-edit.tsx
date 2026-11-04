import { Link } from "react-router";
import { ConfirmButton } from "../components/confirm-dialog";
import { EditForm, PreviewLink } from "../components/editing";
import { LinkFields } from "../components/link-fields";
import { usePolling } from "../components/use-polling";
import { removeAudioFiles } from "../server/audio-files";
import { formatCount, formatDateTime } from "../domain/format";
import { releasePath } from "../domain/releases";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../server/db";
import { releases, releaseTracks, releaseEvents } from "../server/schema";
import { sameOrigin } from "../server/security";
import { storeUpload, uploadForm } from "../server/request";
import { maxUploadBytes } from "../server/config";
import {
  directory,
  formError,
  releaseAccess,
  storeArtwork,
} from "../server/releases";
import {
  metadataLabels,
  releaseFields,
  trackFields,
  parseLinks,
} from "../domain/releases";
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
  let upload: Awaited<ReturnType<typeof uploadForm>> | undefined;
  try {
    upload = await uploadForm(request, maxUploadBytes() + 65536);
    const { form: f, files } = upload;
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
    if (intent === "delete") {
      const files = await db.transaction(async (tx) => {
        const [release] = await tx
          .select()
          .from(releases)
          .where(eq(releases.id, data.release.id))
          .for("update");
        if (!release) throw new Response("Release not found", { status: 404 });
        if (release.published)
          throw new Response("Unpublish this release before deleting it.", {
            status: 409,
          });
        const tracks = await tx
          .select()
          .from(releaseTracks)
          .where(eq(releaseTracks.releaseId, release.id))
          .for("update");
        await tx
          .delete(releaseEvents)
          .where(eq(releaseEvents.releaseId, release.id));
        await tx
          .delete(releaseTracks)
          .where(eq(releaseTracks.releaseId, release.id));
        await tx.delete(releases).where(eq(releases.id, release.id));
        return [
          release.cover,
          ...tracks.flatMap((track) => [
            track.original,
            track.playback,
            track.pendingOriginal,
          ]),
        ];
      });
      await removeAudioFiles(directory(), files);
      return redirect("/releases");
    } else if (intent === "metadata") {
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
      const file = files.get("cover");
      if (!file) throw new Response("Choose artwork", { status: 400 });
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
          .for("no key update");
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
      let key: string | undefined;
      if (intent === "audio") {
        const file = files.get("audio");
        if (!file) throw new Response("Choose a WAV file", { status: 400 });
        key = await storeUpload(file, { limit: maxUploadBytes() });
      }
      await db
        .transaction(async (tx) => {
          await tx
            .select()
            .from(releases)
            .where(eq(releases.id, data.release.id))
            .for("no key update");
          const [track] = await tx
            .select()
            .from(releaseTracks)
            .where(
              and(
                eq(releaseTracks.id, id),
                eq(releaseTracks.releaseId, data.release.id),
              ),
            )
            .for("no key update");
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
              throw new Response(
                "This track already has an upload processing.",
                {
                  status: 409,
                },
              );
            await tx
              .update(releaseTracks)
              .set({ pendingOriginal: key!, error: null })
              .where(eq(releaseTracks.id, id));
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
        })
        .catch(async (error) => {
          if (key) await unlink(join(directory(), key)).catch(() => {});
          throw error;
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
    await removeAudioFiles(directory(), removedFiles);
    if (f.has("_inline")) return { saved: true, error: undefined };
    return redirect(`/releases/${data.release.id}`);
  } catch (error) {
    return formError(error);
  } finally {
    await upload?.discard();
  }
}
const activityKinds = ["visit", "play", "click"];
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
          {metadataLabels[field]}
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
  const [search] = useSearchParams();
  const activity = search.get("view") === "activity" || search.has("page");
  usePolling(
    d.tracks.some((t) => t.pendingOriginal),
    3000,
  );
  return (
    <>
      <div className="editor-heading-actions">
        <PreviewLink href={releasePath(d.artist, d.release) + "?preview=1"}>
          {d.release.published ? "View public page" : "Preview draft"}
        </PreviewLink>
      </div>
      <header className="music-editor-hero">
        {d.release.cover ? (
          <img
            className="editor-cover"
            src={`/release-assets/${d.release.id}/cover`}
            alt="Release artwork"
          />
        ) : (
          <div className="editor-cover artwork-placeholder">Add artwork</div>
        )}
        <div>
          <p className="eyebrow">
            {d.release.published ? "PUBLISHED" : "PRIVATE DRAFT"} ·{" "}
            <Link to={`/artist-profiles/${d.artist.id}`}>{d.artist.name}</Link>
          </p>
          <h1>{d.release.title}</h1>
          <p>
            {d.release.kind} ·{" "}
            {d.release.metadata.releaseDate || "Release date not set"}
          </p>
        </div>
      </header>
      <nav className="section-nav" aria-label="Release views">
        <Link to="?" aria-current={!activity ? "page" : undefined}>
          Release page
        </Link>
        <Link to="?view=activity" aria-current={activity ? "page" : undefined}>
          Activity
        </Link>
      </nav>
      {!activity && (
        <>
          {result?.error && <p role="alert">{result.error}</p>}
          {!d.release.published && (
            <section
              className="panel publish-checklist"
              aria-label="Publication checklist"
            >
              <h2>Ready to publish?</h2>
              <ul>
                <li>
                  {d.release.cover ? (
                    "✓ Artwork added"
                  ) : (
                    <a href="#release-artwork">Add artwork</a>
                  )}
                </li>
                <li>
                  {d.tracks.length ? (
                    "✓ Track list added"
                  ) : (
                    <a href="#release-tracks">Add at least one track</a>
                  )}
                </li>
                <li>
                  {d.release.audioEnabled ? (
                    "✓ Playback and downloads enabled"
                  ) : (
                    <a href="#release-details">
                      Optional: enable playback and downloads
                    </a>
                  )}
                </li>
              </ul>
              <p>
                Audio and additional metadata are optional. A draft is only
                visible to you.
              </p>
              <Form method="post">
                <button
                  className="button-primary"
                  name="intent"
                  value="publish"
                  disabled={!d.release.cover || !d.tracks.length}
                >
                  Publish release
                </button>
              </Form>
            </section>
          )}
          <details className="release-actions">
            <summary>Release actions</summary>
            {d.release.published ? (
              <Form method="post">
                <ConfirmButton
                  name="intent"
                  value="unpublish"
                  confirmTitle={`Unpublish “${d.release.title}”?`}
                  confirmMessage={
                    <p>
                      Its public page and downloads will become unavailable
                      until you publish again.
                    </p>
                  }
                  confirmLabel="Unpublish"
                >
                  Unpublish
                </ConfirmButton>
              </Form>
            ) : (
              <Form method="post">
                <ConfirmButton
                  className="button-danger"
                  name="intent"
                  value="delete"
                  confirmTitle={`Delete “${d.release.title}”?`}
                  confirmMessage={
                    <p>
                      This permanently deletes the draft and all its tracks,
                      artwork, audio and activity. This cannot be undone.
                    </p>
                  }
                  confirmLabel="Delete draft"
                >
                  Delete draft
                </ConfirmButton>
              </Form>
            )}
          </details>
          <p className="muted">
            {d.release.published
              ? "Saved changes are immediately visible on the public page."
              : "Save each section as you work. Preview opens your saved draft in a new tab."}{" "}
            Each Save button saves only its own section.
          </p>
          <div className="editor-controls">
            <EditForm
              label="Release details"
              trigger="Edit release details"
              className="panel"
              key={d.release.id}
              id="release-details"
            >
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
              <Fields
                fields={["releaseDate", "genre"]}
                values={d.release.metadata}
              />
              <details>
                <summary>Credits and release identifiers</summary>
                <Fields
                  fields={releaseFields.filter(
                    (field) => field !== "releaseDate" && field !== "genre",
                  )}
                  values={d.release.metadata}
                />
              </details>
              <LinkFields
                links={d.release.links}
                label="Streaming and shop links"
              />
              <label className="check">
                <input
                  type="checkbox"
                  name="audioEnabled"
                  defaultChecked={d.release.audioEnabled}
                />
                Enable playback and email-gated downloads together
              </label>
              <button className="button-primary">Save release</button>
            </EditForm>
            <EditForm
              label="Artwork"
              trigger={d.release.cover ? "Change artwork" : "Add artwork"}
              encType="multipart/form-data"
              className="panel"
              id="release-artwork"
            >
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
              <button className="button-primary">Upload artwork</button>
            </EditForm>
          </div>
          <h2 id="release-tracks" tabIndex={-1}>
            Track list
          </h2>
          {d.tracks.map((t) => (
            <details className="panel release-track-editor" key={t.id}>
              <summary>
                <strong>
                  {t.position}. {t.title}
                </strong>
                <span className="muted">
                  {t.pendingOriginal
                    ? "Processing audio…"
                    : t.original
                      ? "Audio ready"
                      : "No audio"}
                </span>
              </summary>
              <EditForm
                label={`Track ${t.position}: ${t.title}`}
                trigger="Edit track"
              >
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
                <Fields
                  fields={["artist", "guests", "version"]}
                  values={t.metadata}
                />
                <details>
                  <summary>Credits and track identifiers</summary>
                  <Fields
                    fields={trackFields.filter(
                      (field) =>
                        !["artist", "guests", "version"].includes(field),
                    )}
                    values={t.metadata}
                  />
                </details>
                <label className="check">
                  <input
                    type="checkbox"
                    name="explicit"
                    defaultChecked={t.metadata.explicit}
                  />
                  Explicit
                </label>
                <button className="button-primary">Save track</button>
              </EditForm>
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
              <EditForm
                label={`Audio: ${t.title}`}
                trigger={t.original ? "Replace master" : "Upload master"}
                encType="multipart/form-data"
              >
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
                <button
                  className="button-primary"
                  disabled={!!t.pendingOriginal}
                >
                  {t.original ? "Replace master" : "Upload master"}
                </button>
              </EditForm>
              {(t.original || t.pendingOriginal) && (
                <Form method="post">
                  <input type="hidden" name="track" value={t.id} />
                  <ConfirmButton
                    name="intent"
                    value="remove-audio"
                    confirmTitle={`Remove audio from “${t.title}”?`}
                    confirmMessage={
                      <p>
                        The master and its downloads will be deleted. The track
                        stays in the release.{" "}
                        {d.release.published &&
                          "The public page will show it without audio immediately. "}
                        This cannot be undone.
                      </p>
                    }
                    confirmLabel="Remove audio"
                  >
                    Remove audio
                  </ConfirmButton>
                </Form>
              )}
            </details>
          ))}
          <EditForm
            label="New track"
            trigger="＋ Add track"
            resetOnSave
            className="panel"
          >
            <input type="hidden" name="intent" value="add-track" />
            <label>
              New track title
              <input name="title" required maxLength={200} />
            </label>
            <button className="button-primary">Add track</button>
            <p>
              Audio is optional. Add all tracks, including those without
              downloadable audio.
            </p>
          </EditForm>
        </>
      )}
      {activity && (
        <section className="panel">
          <h2 id="release-activity" tabIndex={-1}>
            Release activity
          </h2>
          {d.stats.length ? (
            <ul>
              {d.stats
                .toSorted(
                  (a, b) =>
                    activityKinds.indexOf(a.kind) -
                    activityKinds.indexOf(b.kind),
                )
                .map((s, i) => (
                  <li key={i}>
                    {s.kind === "visit"
                      ? formatCount(s.count, "page visit")
                      : s.kind === "play"
                        ? `${formatCount(s.count, "play")} · ${d.tracks.find((t) => t.id === s.trackId)?.title || "Removed track"}`
                        : `${formatCount(s.count, "link click")} · ${s.detail}`}
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
                    <td>{formatDateTime(e.createdAt)}</td>
                    <td>{e.email}</td>
                    <td>{e.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.page > 0 && (
            <Link to={`?view=activity&page=${d.page - 1}`}>Newer requests</Link>
          )}
          {d.downloads.length === 50 && (
            <Link to={`?view=activity&page=${d.page + 1}`}>Older requests</Link>
          )}
        </section>
      )}
    </>
  );
}

import { ShareLinks } from "../components/share-links";
import { EditForm, useConfirmDiscard } from "../components/editing";
import { PublicLink } from "../components/public-links";
import { demoWavAvailable } from "../server/download";
import { TrackArtistField } from "../components/track-artist-field";
import { artistChoices, linkedArtist } from "../server/track-artist";
import { uploadVersion } from "../server/upload";
import { limitedBody } from "../server/request";
import { Player, type Playback } from "../components/player";
import { Feedback } from "../components/feedback";
import { Download } from "../components/download";
import { Icon } from "../components/icons";
import type { CommentDraft } from "../components/comment-dialog";
import {
  Form,
  useLoaderData,
  useRevalidator,
  useActionData,
  useSearchParams,
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import {
  and,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  sql,
} from "drizzle-orm";
import { versionStatuses } from "../domain/versions";
import { recordVisit } from "../components/telemetry";
import { useEffect, useRef, useState } from "react";
import { db } from "../server/db";
import { versions, links, reuploadRequests, events } from "../server/schema";
import { sameOrigin, token, hash, origin } from "../server/security";
import { formError } from "../server/releases";
import { trackAccess } from "../server/access";
export const meta = () => [
  { title: "Wavecase" },
  { name: "referrer", content: "same-origin" },
];

export async function loader({ request, params }: LoaderFunctionArgs) {
  let id = params.id;
  const share = params.share;
  if (share) {
    const link = await db.query.links.findFirst({ where: eq(links.id, share) });
    if (!link?.active)
      throw new Response("This link is unavailable.", { status: 404 });
    id = link.trackId;
  }
  const access = await trackAccess(request, id!, share);
  const artist = await linkedArtist(
    access.track.ownerId,
    access.track.artistId,
  );
  const all = await db
    .select()
    .from(versions)
    .where(eq(versions.trackId, id!))
    .orderBy(desc(versions.position));
  return {
    track: {
      ...access.track,
      artist: artist?.name || access.track.artist,
      cover: !!access.track.cover,
    },
    artistUrl: artist
      ? access.owner
        ? `/artist-profiles/${artist.id}`
        : `/artists/${artist.slug}`
      : null,
    artistImageUrl: artist?.hasImage ? `/artist-images/${artist.id}` : null,
    artists: access.owner ? await artistChoices(access.track.ownerId) : [],
    requests: access.owner
      ? await db
          .select()
          .from(reuploadRequests)
          .where(eq(reuploadRequests.trackId, id!))
      : [],
    owner: access.owner,
    preview: access.preview,
    share,
    shareUrl: share ? `${origin}/s/${encodeURIComponent(share)}` : null,
    versions: await Promise.all(
      all
        .filter(
          (v) =>
            access.owner ||
            ((v.state === "ready" || v.state === "missing") &&
              (!access.link?.fromOrder || v.position >= access.link.fromOrder)),
        )
        .map(
          async ({
            original,
            playback,
            pendingOriginal,
            pendingFilename,
            ...v
          }) => ({
            wavDownload: await demoWavAvailable(
              { original, metadata: v.metadata },
              process.env.DATA_DIR || "data/audio",
            ).catch(() => false),
            ...v,
            processing: !!pendingOriginal,
            revision: original ? hash(original) : "missing",
            canDownload:
              !!original &&
              (access.owner || (!!access.link?.download && v.download)),
          }),
        ),
    ),
    links: access.owner
      ? await db
          .select({
            ...getTableColumns(links),
            plays: sql<number>`(${db
              .select({ value: count() })
              .from(events)
              .where(
                and(eq(events.linkId, links.id), eq(events.kind, "play")),
              )})`.mapWith(Number),
          })
          .from(links)
          .where(eq(links.trackId, id!))
          .orderBy(desc(links.createdAt), links.id)
      : [],
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const { owner, track } = await trackAccess(request, params.id!);
  if (!owner) throw new Response("Forbidden", { status: 403 });
  const form = await (
    await limitedBody(
      request,
      Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
    )
  ).formData();
  if (form.get("intent") === "link") {
    const latest = await db.query.versions.findFirst({
      where: and(
        eq(versions.trackId, track.id),
        inArray(versions.state, ["ready", "missing"]),
      ),
      orderBy: desc(versions.position),
    });
    if (form.get("visibility") === "onward" && !latest)
      return {
        error: "Publish a version before creating a latest-and-future link.",
      };
    await db.insert(links).values({
      id: token(),
      trackId: track.id,
      label: String(form.get("label") || "Shared link").slice(0, 200),
      download: form.has("download"),
      fromOrder: form.get("visibility") === "onward" ? latest?.position : null,
    });
  } else {
    try {
      await uploadVersion(track.id, form);
    } catch (error) {
      return formError(error);
    }
  }
  return { ok: true };
}
export default function Track() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<{ error?: string; requested?: boolean }>();
  const visitedShare = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      data.share &&
      !data.owner &&
      !data.preview &&
      visitedShare.current !== data.share
    ) {
      visitedShare.current = data.share;
      recordVisit(data.share);
    }
  }, [data.share, data.owner, data.preview]);
  const [search] = useSearchParams();
  const confirmDiscard = useConfirmDiscard();
  const selectVersion = (id: string) => {
    if (!confirmDiscard(["Version settings", "Version audio"])) return false;
    setSelection(id);
    return true;
  };
  const [selection, setSelection] = useState(
    () =>
      search.get("version") ||
      data.versions.find((v) => v.state === "ready")?.id ||
      data.versions[0]?.id ||
      "",
  );
  const cursor = useRef<Playback>({
    position: 0,
    playing: false,
  });
  const audio = useRef<HTMLAudioElement>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [repeat, setRepeat] = useState(false);
  const current =
    data.versions.find((v) => v.id === selection) ||
    data.versions.find((v) => v.state === "ready") ||
    data.versions[0];
  const revalidator = useRevalidator();
  const artwork = data.track.cover
    ? `/cover/${data.track.id}${data.share ? "?share=" + data.share : ""}${data.preview ? "&preview=1" : ""}`
    : undefined;
  useEffect(() => {
    if (
      data.owner &&
      !data.versions.some((v) => v.state === "processing" || v.processing)
    )
      return;
    const timer = setInterval(
      () => void revalidator.revalidate(),
      data.owner ? 3000 : 30000,
    );
    return () => clearInterval(timer);
  }, [data.versions, data.owner, revalidator]);
  return (
    <>
      {data.owner && data.share && (
        <p>
          <a href={`/tracks/${data.track.id}`}>Back to editing</a>
        </p>
      )}
      {data.track.cover && (
        <img className="cover" alt="Track cover" src={artwork} />
      )}
      <div className="demo-heading">
        <h1>{data.track.title}</h1>
        <p className="eyebrow">
          {data.artistUrl ? (
            <PublicLink
              className="demo-artist"
              to={data.artistUrl}
              rel="noreferrer"
            >
              {data.artistImageUrl && (
                <img src={data.artistImageUrl} alt="" width={32} height={32} />
              )}
              <span>{data.track.artist}</span>
            </PublicLink>
          ) : (
            data.track.artist || "MUSIC IN PROGRESS"
          )}
        </p>
        {data.owner && (
          <a
            className="demo-activity-link"
            href={"/tracks/" + data.track.id + "/analytics"}
          >
            Listening activity
          </a>
        )}
      </div>
      {data.owner && (
        <nav className="section-nav" aria-label="Track actions">
          <EditForm
            label="New version"
            trigger="Upload version"
            resetOnSave
            encType="multipart/form-data"
            className="panel"
          >
            <h2 id="upload-version" tabIndex={-1}>
              Upload a version
            </h2>
            <label>
              Audio file
              <input
                type="file"
                name="audio"
                required
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  const field = e.target.form?.elements.namedItem("name");
                  if (file && field instanceof HTMLInputElement)
                    field.value =
                      file.name.match(/(?:^|[ _-])(v\d+(?:\.\d+)*)/i)?.[1] ||
                      "v1";
                }}
              />
            </label>
            <label>
              Version name
              <input name="name" required defaultValue="v1" />
            </label>
            <label>
              Status
              <select name="status" defaultValue="work in progress">
                {versionStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label>
              Description
              <textarea name="description" />
            </label>
            <label className="check">
              <input type="checkbox" name="download" />
              Allow downloads
            </label>
            <button>Upload version</button>
          </EditForm>
          <ShareLinks
            trackId={data.track.id}
            links={data.links}
            versions={data.versions}
          />
          <a href="#feedback">Feedback</a>
          <a href="#track-details">Track details</a>
        </nav>
      )}
      <p className="muted">{data.track.description}</p>
      {result?.error && <p role="alert">{result.error}</p>}
      {!data.owner && !data.versions.some((v) => v.state === "ready") && (
        <Form
          method="post"
          onSubmit={(event) => {
            if (data.preview) {
              event.preventDefault();
              alert("Preview only. No reupload request was sent.");
              return;
            }
            const field = event.currentTarget.elements.namedItem("name");
            if (field instanceof HTMLInputElement)
              field.value = localStorage.getItem("wavecase.name") || "";
          }}
        >
          <input type="hidden" name="name" />
          <p>Audio file missing.</p>
          <button>Request reupload</button>
          {result?.requested && (
            <p role="status">Your reupload request has been sent.</p>
          )}
        </Form>
      )}
      {data.owner &&
        data.requests.map((r) => (
          <div key={r.linkId} className="panel">
            Reupload requested via{" "}
            {data.links.find((l) => l.id === r.linkId)?.label}
            {r.name && <> · {r.name}</>}
            <Form method="post" action={"/tracks/" + data.track.id + "/manage"}>
              <input type="hidden" name="link" value={r.linkId} />
              <button name="intent" value="dismiss-request">
                Dismiss
              </button>
            </Form>
          </div>
        ))}
      {current && (
        <section className="panel player-panel">
          <label className="version-picker">
            Version
            <select
              value={current.id}
              onChange={(e) => {
                if (selectVersion(e.target.value)) setDraft(null);
              }}
            >
              {data.versions.map((v) => (
                <option value={v.id} key={v.id}>
                  {v.name} · {v.status}
                  {v.state === "missing"
                    ? " · Audio file missing"
                    : v.state === "ready"
                      ? ""
                      : " · " + v.state}
                </option>
              ))}
            </select>
          </label>
          <p>{current.description}</p>
          <div className="metrics">
            {[
              ["LUFS", "lufs"],
              ["Peak (dBFS)", "peak"],
              ["True peak (dBTP)", "truePeak"],
              ["LRA (LU)", "lra"],
            ].map(([label, key]) => (
              <span key={key}>
                {label}{" "}
                <strong>
                  {typeof current.metadata?.[key] === "number"
                    ? Number(current.metadata[key]).toFixed(1)
                    : "—"}
                </strong>
              </span>
            ))}
          </div>
          {current.state === "ready" ? (
            <Player
              key={current.id + current.revision}
              title={data.track.title}
              artist={data.track.artist}
              artwork={artwork}
              playbackRef={cursor}
              audioRef={audio}
              repeat={repeat}
              onRepeatChange={setRepeat}
              onComment={
                data.owner
                  ? undefined
                  : (selection) =>
                      setDraft({ versionId: current.id, ...selection })
              }
              share={data.preview ? undefined : data.share}
              versionId={current.id}
              url={
                "/media/" +
                current.id +
                (data.share ? "?share=" + data.share : "") +
                (data.preview ? "&preview=1" : "")
              }
              peaks={current.peaks || []}
              duration={current.duration || 0}
              metadata={current.metadata}
            />
          ) : (
            <p>
              {current.state === "missing"
                ? "Audio file missing"
                : current.error || "Processing audio…"}
            </p>
          )}
          <div className="track-actions">
            {!data.owner && (
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  setDraft({ versionId: current.id, start: null, end: null })
                }
              >
                Add comment
              </button>
            )}
            <span
              className="tooltip"
              data-tooltip={
                current.canDownload ? "Download audio" : "Download unavailable"
              }
            >
              {current.canDownload ? (
                <Download
                  key={current.id + current.revision}
                  versionId={current.id}
                  versionName={current.name}
                  share={data.share}
                  owner={data.owner}
                  wav={current.wavDownload}
                  preview={data.preview}
                />
              ) : (
                <button
                  className="icon-action"
                  disabled
                  aria-label="Download unavailable"
                >
                  <Icon name="download" />
                </button>
              )}
            </span>
          </div>
        </section>
      )}
      {current && (
        <Feedback
          versionId={current.id}
          share={data.share}
          owner={data.owner}
          preview={data.preview}
          draft={draft}
          onDraftChange={setDraft}
          onSeek={(id, time) => {
            if (current.id !== id && !selectVersion(id)) return;
            cursor.current.position = time;
            if (current.id === id && audio.current)
              audio.current.currentTime = time;
          }}
          links={data.links}
          versions={data.versions}
        />
      )}{" "}
      {data.owner && current && (
        <details className="panel" key={current.id}>
          <summary>Version settings · {current.name}</summary>
          <EditForm
            label="Version settings"
            action={"/tracks/" + data.track.id + "/manage"}
          >
            <input type="hidden" name="intent" value="version" />
            <input type="hidden" name="version" value={current.id} />
            <label>
              Version name
              <input name="name" defaultValue={current.name} required />
            </label>
            <label>
              Description
              <textarea name="description" defaultValue={current.description} />
            </label>
            <label>
              Status
              <select name="status" defaultValue={current.status}>
                {versionStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                name="download"
                defaultChecked={current.download}
              />
              Allow downloads
            </label>
            <button name="intent" value="version">
              Save version
            </button>
          </EditForm>
          <EditForm
            label="Version audio"
            encType="multipart/form-data"
            action={"/tracks/" + data.track.id + "/manage"}
          >
            <input type="hidden" name="intent" value="replace" />
            <input type="hidden" name="version" value={current.id} />
            <label>
              Replace or restore audio
              <input
                type="file"
                name="audio"
                required
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  const field = e.target.form?.elements.namedItem("name");
                  if (file && field instanceof HTMLInputElement)
                    field.value =
                      file.name.match(/(?:^|[ _-])(v\d+(?:\.\d+)*)/i)?.[1] ||
                      "v1";
                }}
              />
            </label>
            <button name="intent" value="replace" disabled={current.processing}>
              Upload replacement
            </button>
          </EditForm>
          <Form
            method="post"
            action={"/tracks/" + data.track.id + "/manage"}
            onSubmit={(e) => {
              if (
                !confirm("Remove this audio? Comments and history will remain.")
              )
                e.preventDefault();
            }}
          >
            <input type="hidden" name="version" value={current.id} />
            <button name="intent" value="remove" className="secondary">
              Remove audio
            </button>
          </Form>
          {current.error && <p role="alert">{current.error}</p>}
        </details>
      )}
      {data.owner && (
        <details className="panel" id="track-details">
          <summary>Track details</summary>
          <Form
            method="post"
            action={"/tracks/" + data.track.id + "/manage"}
            onSubmit={(e) => {
              if (
                !confirm(
                  "Remove all audio for this track? Metadata, links, comments and statistics will remain.",
                )
              )
                e.preventDefault();
            }}
          >
            <button name="intent" value="remove-track" className="secondary">
              Remove all audio
            </button>
          </Form>
          <EditForm
            label="Cover image"
            encType="multipart/form-data"
            action={"/tracks/" + data.track.id + "/manage"}
          >
            <input type="hidden" name="intent" value="cover" />
            <label>
              Cover image
              <input
                type="file"
                name="cover"
                accept="image/png,image/jpeg,image/webp"
                required
              />
            </label>
            <button name="intent" value="cover">
              Upload cover
            </button>
          </EditForm>
          <EditForm
            label="Track details"
            action={"/tracks/" + data.track.id + "/manage"}
          >
            <input type="hidden" name="intent" value="metadata" />
            <label>
              Title
              <input name="title" defaultValue={data.track.title} required />
            </label>
            <TrackArtistField
              key={`${data.track.id}:${data.track.artistId}:${data.track.artist}`}
              profiles={data.artists}
              artistId={data.track.artistId}
              name={data.track.artist}
            />
            <label>
              Description
              <textarea
                name="description"
                defaultValue={data.track.description}
              />
            </label>
            <button name="intent" value="metadata">
              Save details
            </button>
          </EditForm>
        </details>
      )}
    </>
  );
}

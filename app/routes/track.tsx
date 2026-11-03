import {
  DemoIdentity,
  VersionEditor,
  ReplaceAudio,
} from "../components/demo-editors";
import { ShareLinks } from "../components/share-links";
import { visibleThroughLink } from "../domain/share-links";
import { shareVersionScope } from "../server/share-links";
import { EditForm, useConfirmDiscard } from "../components/editing";
import { demoWavAvailable } from "../server/download";
import { artistChoices, linkedArtist } from "../server/track-artist";
import { uploadVersion } from "../server/upload";
import { limitedBody } from "../server/request";
import { useWorkspacePlayback } from "../components/workspace-player";
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
import { and, count, desc, eq, getTableColumns, sql } from "drizzle-orm";
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
      coverRevision: access.track.cover ? hash(access.track.cover) : null,
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
        .filter((v) => access.owner || visibleThroughLink(v, access.link!))
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
            downloads: sql<number>`(${db
              .select({ value: count() })
              .from(events)
              .where(
                and(
                  eq(events.linkId, links.id),
                  eq(events.kind, "download-started"),
                ),
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
    try {
      const scope = await shareVersionScope(
        track.id,
        form.get("visibility") || "onward",
        form.get("from"),
      );
      await db.insert(links).values({
        id: token(),
        trackId: track.id,
        label: String(form.get("label") || "Shared link").slice(0, 200),
        download: form.has("download"),
        ...scope,
      });
    } catch (error) {
      return formError(error);
    }
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
  return <TrackContents key={data.track.id} />;
}
function TrackContents() {
  const workspace = useWorkspacePlayback();
  const data = useLoaderData<typeof loader>();
  const result = useActionData<{ error?: string; requested?: boolean }>();
  const available = data.versions
    .filter((v) => v.state === "ready")
    .map((v) => v.id + v.revision)
    .join(",");
  useEffect(() => {
    const active = workspace?.getSnapshot();
    if (active?.trackId === data.track.id)
      active.playback?.reconcile(available.split(","));
  }, [workspace, data.track.id, available]);
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
    if (!confirmDiscard(["Edit version", "Replace audio"])) return false;
    setSelection(id);
    return true;
  };
  const [selection, setSelection] = useState(
    () =>
      search.get("version") ||
      (workspace?.getSnapshot().trackId === data.track.id
        ? workspace.getSnapshot().playback?.getSnapshot().source?.versionId
        : undefined) ||
      data.versions.find((v) => v.state === "ready")?.id ||
      data.versions[0]?.id ||
      "",
  );
  const requestedVersion = search.get("version");
  useEffect(() => {
    if (requestedVersion) setSelection(requestedVersion);
  }, [requestedVersion]);
  const cursor = useRef<Playback>({
    position: 0,
    playing: false,
  });
  const [seekRequest, setSeekRequest] = useState<{
    versionId: string;
    position: number;
  } | null>(null);
  const [draft, setDraft] = useState<CommentDraft | null>(null);
  const [repeat, setRepeat] = useState(false);
  const current =
    data.versions.find((v) => v.id === selection) ||
    data.versions.find((v) => v.state === "ready") ||
    data.versions[0];
  const revalidator = useRevalidator();
  const artwork = data.track.cover
    ? `/cover/${data.track.id}?v=${data.track.coverRevision}${data.share ? "&share=" + data.share : ""}${data.preview ? "&preview=1" : ""}`
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
      <DemoIdentity data={data} artwork={artwork} />
      {data.owner && (
        <nav className="section-nav" aria-label="Track actions">
          <EditForm
            label="New version"
            trigger="Upload new version"
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
              <select
                name="status"
                defaultValue={data.versions[0]?.status ?? "early idea"}
              >
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
            <button>Upload new version</button>
          </EditForm>
        </nav>
      )}
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
          <div className="version-heading">
            <label className="version-picker">
              <span className="sr-only">Version</span>
              <span className="version-select-size">
                <span aria-hidden="true">{current.name}</span>
                <select
                  value={current.id}
                  onChange={(e) => {
                    if (selectVersion(e.target.value)) setDraft(null);
                  }}
                >
                  {data.versions.map((v) => (
                    <option value={v.id} key={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              </span>
            </label>
            {data.owner && (
              <VersionEditor trackId={data.track.id} version={current} />
            )}
          </div>
          <p>
            {current.status}
            {data.owner &&
              ` · ${current.download ? "Downloads allowed" : "Downloads disabled"}`}
          </p>
          {current.description && (
            <p className="demo-description">{current.description}</p>
          )}
          {data.owner && current.processing && (
            <p role="status">Processing replacement audio…</p>
          )}
          {data.owner && current.error && <p role="alert">{current.error}</p>}
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
          <div className="demo-waveform">
            {data.owner && (
              <ReplaceAudio trackId={data.track.id} version={current} />
            )}
            {current.state === "ready" ? (
              <Player
                key={`${data.track.id}:${data.share || ""}:${data.preview}`}
                trackId={data.track.id}
                versionName={current.name}
                revision={current.revision}
                seekRequest={seekRequest}
                availableSources={data.versions
                  .filter((v) => v.state === "ready")
                  .map((v) => v.id + v.revision)
                  .join(",")}
                title={data.track.title}
                artist={data.track.artist}
                artwork={artwork}
                playbackRef={cursor}
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
              <div className="audio-unavailable" role="status">
                <strong>
                  {current.state === "missing"
                    ? "Audio unavailable"
                    : current.state === "failed"
                      ? "Audio could not be processed"
                      : "Processing audio…"}
                </strong>
                {current.state === "missing" && (
                  <p>
                    The audio for this version is currently unavailable. Please
                    check back later.
                  </p>
                )}
              </div>
            )}
          </div>
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
      {data.owner && (
        <ShareLinks
          trackId={data.track.id}
          links={data.links}
          versions={data.versions}
        />
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
            setSeekRequest({ versionId: id, position: time });
          }}
          links={data.links}
          versions={data.versions}
        />
      )}{" "}
    </>
  );
}

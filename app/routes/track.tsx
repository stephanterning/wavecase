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
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { and, desc, eq, inArray } from "drizzle-orm";
import { versionStatuses } from "../domain/versions";
import { recordVisit, listenerIdentity } from "../components/telemetry";
import { useEffect, useRef, useState } from "react";
import { db } from "../server/db";
import { versions, links, reuploadRequests } from "../server/schema";
import { sameOrigin, token, hash, origin } from "../server/security";
import { trackAccess } from "../server/access";
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
    artistUrl: artist ? `/artists/${artist.slug}` : null,
    artistImageUrl: artist?.hasImage ? `/artist-images/${artist.id}` : null,
    artists: access.owner ? await artistChoices(access.track.ownerId) : [],
    requests: access.owner
      ? await db
          .select()
          .from(reuploadRequests)
          .where(eq(reuploadRequests.trackId, id!))
      : [],
    owner: access.owner,
    share,
    shareUrl: share ? `${origin}/s/${encodeURIComponent(share)}` : null,
    versions: all
      .filter(
        (v) =>
          access.owner ||
          ((v.state === "ready" || v.state === "missing") &&
            (!access.link?.fromOrder || v.position >= access.link.fromOrder)),
      )
      .map(
        ({ original, playback, pendingOriginal, pendingFilename, ...v }) => ({
          ...v,
          processing: !!pendingOriginal,
          revision: original ? hash(original) : "missing",
          canDownload:
            !!original &&
            (access.owner || (!!access.link?.download && v.download)),
        }),
      ),
    links: access.owner
      ? await db.select().from(links).where(eq(links.trackId, id!))
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
    await uploadVersion(track.id, form);
  }
  return { ok: true };
}
export default function Track() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<{ error?: string; requested?: boolean }>();
  const visitedShare = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (data.share && !data.owner && visitedShare.current !== data.share) {
      visitedShare.current = data.share;
      recordVisit(data.share);
    }
  }, [data.share, data.owner]);
  const [selection, setSelection] = useState("");
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
    ? `/cover/${data.track.id}${data.share ? "?share=" + data.share : ""}`
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
      <a href="/library" hidden={!data.owner}>
        ← Your library
      </a>
      {data.owner && (
        <p>
          <a href={"/tracks/" + data.track.id + "/analytics"}>
            Listening activity
          </a>
        </p>
      )}
      <p className="eyebrow">
        {data.artistUrl ? (
          <a className="demo-artist" href={data.artistUrl} rel="noreferrer">
            {data.artistImageUrl && (
              <img src={data.artistImageUrl} alt="" width={32} height={32} />
            )}
            <span>{data.track.artist}</span>
          </a>
        ) : (
          data.track.artist || "MUSIC IN PROGRESS"
        )}
      </p>
      {data.track.cover && (
        <img className="cover" alt="Track cover" src={artwork} />
      )}
      <h1>{data.track.title}</h1>
      <p className="muted">{data.track.description}</p>
      {result?.error && <p role="alert">{result.error}</p>}
      {!data.owner && !data.versions.some((v) => v.state === "ready") && (
        <Form
          method="post"
          onSubmit={(event) => {
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
                setDraft(null);
                setSelection(e.target.value);
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
              share={data.share}
              versionId={current.id}
              url={
                "/media/" +
                current.id +
                (data.share ? "?share=" + data.share : "")
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
              {current.canDownload && current.metadata?.audioPolicy === 2 ? (
                <Download
                  key={current.id + current.revision}
                  versionId={current.id}
                  versionName={current.name}
                  share={data.share}
                  wav={current.metadata?.wavDownload === true}
                />
              ) : current.canDownload ? (
                <a
                  className="icon-action"
                  aria-label="Download original"
                  href={
                    "/media/" +
                    current.id +
                    "?download=1" +
                    (data.share ? "&share=" + data.share : "")
                  }
                  onClick={(e) => {
                    if (data.share) {
                      const url = new URL(e.currentTarget.href);
                      const identity = listenerIdentity(data.share);
                      url.searchParams.set("browser", identity.browser);
                      url.searchParams.set("session", identity.session);
                      e.currentTarget.href = url.toString();
                    }
                  }}
                >
                  <Icon name="download" />
                </a>
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
          draft={draft}
          onDraftChange={setDraft}
          onSeek={(id, time) => {
            cursor.current.position = time;
            if (current.id === id && audio.current)
              audio.current.currentTime = time;
            else setSelection(id);
          }}
          links={data.links}
          versions={data.versions}
        />
      )}{" "}
      {data.owner && current && (
        <details className="panel" key={current.id}>
          <summary>Version settings · {current.name}</summary>
          <Form method="post" action={"/tracks/" + data.track.id + "/manage"}>
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
          </Form>
          <Form
            method="post"
            encType="multipart/form-data"
            action={"/tracks/" + data.track.id + "/manage"}
          >
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
          </Form>
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
        <details className="panel">
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
          <Form
            method="post"
            encType="multipart/form-data"
            action={"/tracks/" + data.track.id + "/manage"}
          >
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
          </Form>
          <Form method="post" action={"/tracks/" + data.track.id + "/manage"}>
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
          </Form>
        </details>
      )}
      {data.owner && (
        <div className="grid">
          <Form method="post" encType="multipart/form-data" className="panel">
            <h2>Upload a version</h2>
            <label>
              Status
              <select name="status" defaultValue="work in progress">
                {versionStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
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
              Description
              <textarea name="description" />
            </label>
            <label className="check">
              <input type="checkbox" name="download" />
              Allow downloads
            </label>
            <button>Upload version</button>
          </Form>
          <section className="panel">
            <h2>Share links</h2>
            {data.links.map((link) => (
              <details key={link.id}>
                <summary>
                  {link.label} · {link.active ? "Active" : "Disabled"}
                </summary>
                <p>
                  <a href={"/s/" + link.id}>Open share page</a>
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    void navigator.clipboard.writeText(
                      window.location.origin + "/s/" + link.id,
                    )
                  }
                >
                  Copy link
                </button>
                <Form
                  method="post"
                  action={"/tracks/" + data.track.id + "/manage"}
                >
                  <input type="hidden" name="link" value={link.id} />
                  <label>
                    Private label
                    <input name="label" defaultValue={link.label} required />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="active"
                      defaultChecked={link.active}
                    />
                    Active
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      name="download"
                      defaultChecked={link.download}
                    />
                    Allow downloads
                  </label>
                  <label>
                    Visible versions
                    <select
                      name="from"
                      defaultValue={
                        link.fromOrder
                          ? data.versions.find(
                              (v) => v.position === link.fromOrder,
                            )?.id || ""
                          : ""
                      }
                    >
                      <option value="">All versions</option>
                      {data.versions.map((v) => (
                        <option key={v.id} value={v.id}>
                          From {v.name} onward
                        </option>
                      ))}
                    </select>
                  </label>
                  <button name="intent" value="link">
                    Save link
                  </button>
                </Form>
              </details>
            ))}
            <Form method="post">
              <input type="hidden" name="intent" value="link" />
              <label>
                Private label
                <input name="label" required />
              </label>
              <label>
                Versions
                <select name="visibility" defaultValue="onward">
                  <option value="all">All versions</option>
                  <option value="onward">Latest and future versions</option>
                </select>
              </label>
              <label className="check">
                <input type="checkbox" name="download" />
                Allow downloads
              </label>
              <button>Create link</button>
            </Form>
          </section>
        </div>
      )}
    </>
  );
}

import { trackScope } from "../server/ownership";
import { useState, useRef, useEffect } from "react";
import {
  useWorkspacePlayback,
  useWorkspaceSnapshot,
} from "../components/workspace-player";
import { useSyncExternalStore } from "react";
import { Icon } from "../components/icons";
import { playbackGainDb } from "../components/playback-audio";
import type { DemoSource } from "../components/demo-playback";
import { TrackArtistField } from "../components/track-artist-field";
import { artistChoices, resolveTrackArtist } from "../server/track-artist";
import { uploadVersion } from "../server/upload";
import { limitedBody } from "../server/request";
import { versionStatuses } from "../domain/versions";
import { redirect } from "react-router";
import {
  Link,
  Form,
  useLoaderData,
  useActionData,
  useNavigation,
  useSearchParams,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { and, desc, eq, getTableColumns, isNotNull, sql } from "drizzle-orm";
import { db } from "../server/db";
import { tracks, versions } from "../server/schema";
import { hash, requireUser, sameOrigin } from "../server/security";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const ready = await db
    .select({
      id: versions.id,
      trackId: versions.trackId,
      original: versions.original,
      name: versions.name,
      metadata: versions.metadata,
      duration: versions.duration,
    })
    .from(versions)
    .innerJoin(tracks, eq(versions.trackId, tracks.id))
    .where(
      and(
        trackScope(user.id),
        eq(versions.state, "ready"),
        isNotNull(versions.playback),
      ),
    )
    .orderBy(desc(versions.position));
  const playable = ready.map(({ original, ...version }) => ({
    ...version,
    revision: original ? hash(original) : "missing",
  }));
  return {
    user,
    availableSources: playable.map((v) => v.id + v.revision),
    playable: playable.filter(
      (v, index) =>
        playable.findIndex((other) => other.trackId === v.trackId) === index,
    ),
    artists: await artistChoices(user.id),
    tracks: await db
      .select({
        ...getTableColumns(tracks),
        latestVersion: sql<string | null>`(${db
          .select({ name: versions.name })
          .from(versions)
          .where(eq(versions.trackId, tracks.id))
          .orderBy(desc(versions.position))
          .limit(1)})`,
        latestStatus: sql<string | null>`(${db
          .select({ status: versions.status })
          .from(versions)
          .where(eq(versions.trackId, tracks.id))
          .orderBy(desc(versions.position))
          .limit(1)})`,
      })
      .from(tracks)
      .where(trackScope(user.id)),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const form = await (
    await limitedBody(
      request,
      Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
    )
  ).formData();
  const title = String(form.get("title") || "").trim();
  if (!title || title.length > 200)
    return { error: "Enter a title of up to 200 characters." };
  let artist;
  try {
    artist = await resolveTrackArtist(user.id, form);
  } catch (error) {
    if (error instanceof Response && error.status === 400)
      return { error: await error.text() };
    throw error;
  }
  const [track] = await db
    .insert(tracks)
    .values({ ownerId: user.id, title, ...artist })
    .returning();
  const file = form.get("audio");
  if (file instanceof File && file.size) await uploadVersion(track.id, form);
  return redirect("/tracks/" + track.id);
}
function LibraryPlay({
  source,
}: {
  source: (DemoSource & { trackId: string }) | null;
}) {
  const workspace = useWorkspacePlayback()!;
  const { playback, trackId } = useWorkspaceSnapshot(workspace);
  const empty = () => null;
  const state = useSyncExternalStore(
    playback?.subscribe ?? (() => () => {}),
    playback?.getSnapshot ?? empty,
    playback?.getSnapshot ?? empty,
  );
  const active =
    (state?.source?.key === source?.key ||
      (!state?.source && trackId === source?.trackId)) &&
    (state?.playing || state?.starting);
  return (
    <button
      type="button"
      className="icon-action library-play"
      disabled={!source}
      aria-label={
        source
          ? `${active ? "Pause" : "Play"} ${source.title}`
          : "No playable version"
      }
      onClick={() => {
        if (source) workspace.start(source);
      }}
    >
      <Icon name={active ? "pause" : "play"} />
    </button>
  );
}
export default function Library() {
  const workspace = useWorkspacePlayback()!;
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  useEffect(() => {
    workspace.getSnapshot().playback?.reconcile(data.availableSources);
  }, [workspace, data.availableSources]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"title" | "createdAt" | "artist">(
    "createdAt",
  );
  const [ascending, setAscending] = useState(false);
  const navigation = useNavigation();
  const [search] = useSearchParams();
  const dialog = useRef<HTMLDialogElement>(null);
  const createTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      (result?.error || search.get("create") === "1") &&
      !dialog.current?.open
    )
      dialog.current?.showModal();
  }, [result, search]);
  const rows = data.tracks
    .map((track) => ({
      ...track,
      artist:
        data.artists.find((artist) => artist.id === track.artistId)?.name ??
        track.artist,
    }))
    .filter((track) =>
      `${track.title} ${track.artist}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const order =
        sort === "createdAt"
          ? new Date(a[sort]).getTime() - new Date(b[sort]).getTime()
          : a[sort].localeCompare(b[sort], undefined, {
              sensitivity: "base",
              numeric: true,
            });
      return (ascending ? order : -order) || a.id.localeCompare(b.id);
    });
  return (
    <>
      <div className="heading">
        <div>
          <p className="eyebrow">YOUR LIBRARY</p>
          <h1>Work in progress</h1>
        </div>
      </div>
      <div className="library-toolbar">
        <button
          ref={createTrigger}
          type="button"
          onClick={() => dialog.current?.showModal()}
        >
          Add new track
        </button>
        <div className="library-filter">
          <div className="library-filter-input">
            <input
              aria-label="Search your music"
              id="track-filter"
              type="search"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Search your music…"
            />
          </div>
        </div>
      </div>
      <div
        className="library-scroll"
        role="region"
        aria-label="Tracks"
        tabIndex={0}
      >
        <table className="library-table">
          <thead>
            <tr>
              <th scope="col" aria-label="Playback" />
              {(
                [
                  ["title", "Name"],
                  ["createdAt", "Created"],
                  ["artist", "Artist"],
                ] as const
              ).map(([key, label]) => (
                <th
                  key={key}
                  scope="col"
                  aria-sort={
                    sort === key
                      ? ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setSort(key);
                      setAscending(
                        sort === key
                          ? !ascending
                          : key === "title" || key === "artist",
                      );
                    }}
                  >
                    {label}
                    {sort === key && (
                      <span aria-hidden="true">{ascending ? " ↑" : " ↓"}</span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((track) => {
              const version = data.playable.find((v) => v.trackId === track.id);
              const source = version
                ? {
                    trackId: track.id,
                    key: version.id + version.revision,
                    versionId: version.id,
                    versionName: version.name,
                    title: track.title,
                    artist: track.artist,
                    url: `/media/${version.id}`,
                    duration: version.duration || 0,
                    gainDb: playbackGainDb(version.metadata),
                    peaks: [],
                    artwork: track.cover ? `/cover/${track.id}` : undefined,
                  }
                : null;
              return (
                <tr key={track.id}>
                  <td>
                    <LibraryPlay source={source} />
                  </td>
                  <td>
                    <Link
                      className="library-row-link"
                      to={"/tracks/" + track.id}
                    >
                      {track.title}
                    </Link>
                    <small className="track-summary">
                      {track.latestVersion
                        ? `${track.latestVersion} · ${track.latestStatus}`
                        : "No versions yet"}
                    </small>
                  </td>
                  <td>
                    <time dateTime={new Date(track.createdAt).toISOString()}>
                      {new Date(track.createdAt).toISOString().slice(0, 10)}
                    </time>
                  </td>
                  <td>{track.artist || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p role="status" className="muted">
          {data.tracks.length
            ? "No tracks match your filter."
            : "Your library is quiet. Add a track to get started."}
        </p>
      )}
      <dialog
        ref={dialog}
        onClose={() => createTrigger.current?.focus()}
        className="comment-dialog"
        aria-labelledby="new-track-title"
      >
        <Form method="post" encType="multipart/form-data" className="panel">
          <h2 id="new-track-title">Add new track</h2>

          <label>
            First audio version (optional)
            <input
              type="file"
              name="audio"
              onChange={(e) => {
                const file = e.target.files?.[0];
                const title = e.target.form?.elements.namedItem("title");
                if (file && title instanceof HTMLInputElement && !title.value)
                  title.value = file.name
                    .replace(/\.[^.]+$/, "")
                    .replace(/[ _-]+v\d+(?:\.\d+)*$/i, "")
                    .replace(/_/g, " ");
              }}
            />
          </label>
          <label>
            Title
            <input name="title" required maxLength={200} />
          </label>
          <label>
            First version status
            <select name="status" defaultValue="early idea">
              {versionStatuses.map((status) => (
                <option key={status}>{status}</option>
              ))}
            </select>
          </label>
          <TrackArtistField profiles={data.artists} />
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => dialog.current?.close()}
            >
              Cancel
            </button>
            <button disabled={navigation.state !== "idle"}>
              {navigation.state !== "idle" ? "Creating…" : "Create track"}
            </button>
          </div>
          {result?.error && <p role="alert">{result.error}</p>}
        </Form>
      </dialog>
    </>
  );
}

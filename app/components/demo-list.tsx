import {
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Link, useFetcher } from "react-router";
import type { DemoListData } from "../server/demo-list";
import type { action as libraryAction } from "../routes/library";
import { compareLibraryTracks, type LibrarySort } from "../domain/library";
import { formatDate } from "../domain/format";
import type { DemoSource } from "./demo-playback";
import { IconButton } from "./icon-button";
import { Icon } from "./icons";
import { playbackGainDb } from "./playback-audio";
import { useWorkspacePlayback, useWorkspaceSnapshot } from "./workspace-player";

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
    <IconButton
      className="icon-action library-play"
      icon={active ? "pause" : "play"}
      disabled={!source}
      label={
        source
          ? `${active ? "Pause" : "Play"} ${source.title}`
          : "No playable version"
      }
      onClick={() => {
        if (source) workspace.start(source);
      }}
    />
  );
}
export function DemoList({
  data,
  children,
  emptyMessage = "Your library is quiet. Add a track to get started.",
}: {
  data: DemoListData;
  children?: ReactNode;
  emptyMessage?: string;
}) {
  const workspace = useWorkspacePlayback()!;
  const filterId = useId();
  useEffect(() => {
    workspace.getSnapshot().playback?.reconcile(data.availableSources);
  }, [workspace, data.availableSources]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<LibrarySort>("updatedAt");
  const [ascending, setAscending] = useState(false);
  const rows = data.tracks
    .filter((track) =>
      `${track.title} ${track.artist}`
        .toLocaleLowerCase()
        .includes(filter.toLocaleLowerCase()),
    )
    .sort((a, b) => compareLibraryTracks(a, b, sort, ascending));
  return (
    <>
      <div className="library-toolbar">
        {children}
        <div className="library-filter">
          <div className="library-filter-input">
            <input
              aria-label="Search your music"
              id={filterId}
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
              {(
                [
                  ["favorite", "Favorite"],
                  ["title", "Name"],
                  ["artist", "Artist"],
                  ["versionCount", "Versions"],
                  ["updatedAt", "Updated"],
                  ["createdAt", "Created"],
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
                    aria-label={
                      key === "favorite" ? "Sort by favorite" : undefined
                    }
                    title={key === "favorite" ? "Sort by favorite" : undefined}
                    onClick={() => {
                      setSort(key);
                      setAscending(
                        sort === key
                          ? !ascending
                          : key === "title" || key === "artist",
                      );
                    }}
                  >
                    {key === "favorite" ? <Icon name="heart" /> : label}
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
                  <td className="library-favorite-cell">
                    <FavoriteButton track={track} />
                  </td>
                  <td className="library-name-cell">
                    <div className="library-track">
                      <LibraryPlay source={source} />
                      <div>
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
                          {track.latestState === "failed" && (
                            <span className="track-summary-failed">
                              {" "}
                              · Processing failed
                            </span>
                          )}
                        </small>
                      </div>
                    </div>
                  </td>
                  <td>{track.artist || "—"}</td>
                  <td>{track.versionCount}</td>
                  <td>
                    {track.updatedAt ? (
                      <time dateTime={new Date(track.updatedAt).toISOString()}>
                        {formatDate(track.updatedAt)}
                      </time>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <time dateTime={new Date(track.createdAt).toISOString()}>
                      {formatDate(track.createdAt)}
                    </time>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p role="status" className="muted">
          {data.tracks.length ? "No tracks match your filter." : emptyMessage}
        </p>
      )}
    </>
  );
}

function FavoriteButton({
  track,
}: {
  track: { id: string; title: string; favorite: boolean };
}) {
  const fetcher = useFetcher<typeof libraryAction>();
  const favorite = fetcher.formData
    ? fetcher.formData.get("favorite") === "1"
    : track.favorite;
  const label = favorite
    ? `Remove ${track.title} from favorites`
    : `Add ${track.title} to favorites`;
  return (
    <>
      <fetcher.Form method="post" action="/library">
        <input type="hidden" name="intent" value="favorite" />
        <input type="hidden" name="trackId" value={track.id} />
        <input type="hidden" name="favorite" value={favorite ? "0" : "1"} />
        <IconButton
          className="library-favorite"
          type="submit"
          icon="heart"
          label={label}
          aria-pressed={favorite}
          disabled={fetcher.state !== "idle"}
        />
      </fetcher.Form>
      {fetcher.data?.error && <small role="alert">{fetcher.data.error}</small>}
    </>
  );
}

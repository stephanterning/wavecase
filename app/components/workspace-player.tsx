import { attachAudioCacheSession } from "./compressed-audio-cache";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { WorkspacePlayback } from "./workspace-playback";
import { type DemoPlayback } from "./demo-playback";
import { useMediaSession } from "./media-session";
import { Icon } from "./icons";

const WorkspaceAudio = createContext<WorkspacePlayback | null>(null);
export const useWorkspacePlayback = () => useContext(WorkspaceAudio);
export function useWorkspaceSnapshot(workspace: WorkspacePlayback) {
  return useSyncExternalStore(
    workspace.subscribe,
    workspace.getSnapshot,
    workspace.getSnapshot,
  );
}
export function WorkspacePlayerProvider({ children }: { children: ReactNode }) {
  const [workspace] = useState(() => new WorkspacePlayback());
  const { playback, trackId } = useWorkspaceSnapshot(workspace);
  useEffect(() => {
    const clearCache = attachAudioCacheSession();
    window.addEventListener("wavecase-access-revoked", workspace.dispose);
    return () => {
      window.removeEventListener("wavecase-access-revoked", workspace.dispose);
      workspace.dispose();
      clearCache();
    };
  }, [workspace]);
  return (
    <WorkspaceAudio value={workspace}>
      {children}
      {playback && trackId && (
        <WorkspacePlayer playback={playback} trackId={trackId} />
      )}
    </WorkspaceAudio>
  );
}
function WorkspacePlayer({
  playback,
  trackId,
}: {
  playback: DemoPlayback;
  trackId: string;
}) {
  const { source, media, playing, starting, loading, error, repeating } =
    useSyncExternalStore(
      playback.subscribe,
      playback.getSnapshot,
      playback.getSnapshot,
    );
  const active = playing || starting;
  const toggle = () => {
    if (active) playback.pause();
    else void playback.play().catch(() => {});
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.code !== "Space" && event.key !== " ") ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest(
            "input, textarea, select, dialog, [role='dialog'], [role='textbox']",
          ))
      )
        return;
      const state = playback.getSnapshot();
      if (!state.source && !state.loading) return;
      event.preventDefault();
      if (!event.repeat) {
        if (state.playing || state.starting) playback.pause();
        else void playback.play().catch(() => {});
      }
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [playback]);
  useMediaSession(
    media,
    {
      title: source?.title,
      artist: source?.artist,
      artwork: source?.artwork
        ? { src: source.artwork, type: "image/jpeg" }
        : null,
    },
    () => {},
    playback.play,
    playback.pause,
  );
  if (!source && !loading && !starting && !error) return null;
  const href = `/tracks/${trackId}${source ? `?version=${source.versionId}` : ""}`;
  return (
    <aside className="release-mini demo-mini" aria-label="Demo player">
      {source && (
        <>
          <Link
            to={href}
            className="release-mini-artwork"
            aria-label={`Open ${source.title}`}
          >
            {source.artwork ? (
              <img src={source.artwork} alt="" width={52} height={52} />
            ) : (
              <span aria-hidden="true">♫</span>
            )}
          </Link>
          <div className="release-mini-description">
            <Link to={href}>{source.title}</Link>
            <span>
              {[source.artist, source.versionName].filter(Boolean).join(" · ")}
            </span>
          </div>
        </>
      )}
      {(source || loading) && (
        <>
          <button
            type="button"
            className="icon-action play-toggle"
            aria-label={active ? "Pause" : "Play"}
            aria-keyshortcuts="Space"
            onClick={toggle}
          >
            <Icon name={active ? "pause" : "play"} />
          </button>
          <button
            type="button"
            className="icon-action"
            aria-label="Repeat demo"
            aria-pressed={repeating}
            onClick={() => playback.setRepeat(!repeating)}
          >
            <Icon name="repeat" />
          </button>
        </>
      )}
      {loading && <span role="status">Loading audio…</span>}
      {error && (
        <p role="alert">
          {error} {!source && <Link to="/library">Choose a demo</Link>}
        </p>
      )}
    </aside>
  );
}

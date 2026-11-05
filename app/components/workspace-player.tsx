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
import { IconButton } from "./icon-button";
import { useSpaceToggle } from "./use-space-toggle";

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
    const state = playback.getSnapshot();
    if (state.playing || state.starting) playback.pause();
    else void playback.play().catch(() => {});
  };
  useSpaceToggle({
    ready: () => {
      const state = playback.getSnapshot();
      return !!state.source || state.loading;
    },
    toggle,
  });
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
          <IconButton
            className="icon-action play-toggle"
            icon={active ? "pause" : "play"}
            label={active ? "Pause" : "Play"}
            tooltip={active ? "Pause (Space)" : "Play (Space)"}
            aria-keyshortcuts="Space"
            onClick={toggle}
          />
          <IconButton
            className="icon-action"
            icon="repeat"
            label="Repeat demo"
            tooltip={repeating ? "Repeat demo on" : "Repeat demo off"}
            aria-pressed={repeating}
            onClick={() => playback.setRepeat(!repeating)}
          />
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

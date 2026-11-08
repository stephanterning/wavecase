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
import { setRepeatPreference, useRepeatPreference } from "./repeat-preference";
import { MiniPlayer } from "./mini-player";
import { ReleaseSeek } from "./release-seek";
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
  const { source, media, playing, starting, loading, error } =
    useSyncExternalStore(
      playback.subscribe,
      playback.getSnapshot,
      playback.getSnapshot,
    );
  const repeat = useRepeatPreference();
  const [position, setPosition] = useState(0);
  useEffect(() => {
    const remember = () => setPosition(media?.currentTime ?? 0);
    const events = ["timeupdate", "seeked", "wavecase-user-seeked"];
    remember();
    for (const event of events) media?.addEventListener(event, remember);
    return () => {
      for (const event of events) media?.removeEventListener(event, remember);
    };
  }, [media]);
  useEffect(() => {
    playback.setRepeat(repeat);
  }, [playback, repeat]);
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
    slider: true,
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
    <MiniPlayer
      label="Demo player"
      className="demo-mini"
      track={
        source
          ? {
              title: source.title,
              details: [source.artist, source.versionName]
                .filter(Boolean)
                .join(" · "),
              href,
              page: source.title,
              artwork: source.artwork,
            }
          : undefined
      }
      controls={!!source || loading}
      playing={active}
      onToggle={toggle}
      repeatLabel="Repeat demo"
      repeating={repeat}
      onRepeat={setRepeatPreference}
    >
      {source && (
        <ReleaseSeek
          key={source.key}
          position={position}
          duration={source.duration}
          onSeek={(next) => playback.seek(source.versionId, next)}
        />
      )}
      {loading && <span role="status">Loading audio…</span>}
      {error && (
        <p role="alert">
          {error} {!source && <Link to="/library">Choose a demo</Link>}
        </p>
      )}
    </MiniPlayer>
  );
}

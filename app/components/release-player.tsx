import { attachAudioCacheSession } from "./compressed-audio-cache";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ReleasePlayback } from "./release-playback";
import { useMediaSession } from "./media-session";
import { setRepeatPreference, useRepeatPreference } from "./repeat-preference";
import { BufferedAudio } from "./buffered-audio";
import { MiniPlayer } from "./mini-player";
import { ReleaseSeek } from "./release-seek";
import { useSpaceToggle } from "./use-space-toggle";

const PlaybackContext = createContext<ReleasePlayback | null>(null);

export function useReleasePlayer() {
  const playback = useContext(PlaybackContext);
  if (!playback)
    throw new Error("Release playback requires the public music layout.");
  const state = useSyncExternalStore(
    playback.subscribe,
    playback.getSnapshot,
    playback.getSnapshot,
  );
  return { playback, ...state };
}

export function ReleasePlayerProvider({ children }: { children: ReactNode }) {
  const [playback] = useState(() => new ReleasePlayback());
  return (
    <PlaybackContext value={playback}>
      {children}
      <ReleasePlayer />
    </PlaybackContext>
  );
}

function ReleasePlayer() {
  const {
    playback,
    queue,
    index,
    status,
    error,
    seeking,
    media,
    position,
    duration,
  } = useReleasePlayer();
  const repeat = useRepeatPreference();
  useEffect(() => {
    playback.setRepeat(repeat);
  }, [playback, repeat]);
  const track = queue?.tracks[index];
  const active = status === "playing" || status === "loading";
  useEffect(() => {
    const clearCache = attachAudioCacheSession();
    const detach = playback.attach();
    return () => {
      detach();
      clearCache();
    };
  }, [playback]);
  useSpaceToggle({
    ready: () => !!playback.getSnapshot().queue,
    toggle: playback.toggle,
    slider: true,
  });
  useMediaSession(
    media,
    {
      title: track?.title,
      artist: track?.artist,
      album: queue?.title,
      artwork: queue?.artwork,
    },
    () => playback.fail(),
    playback.play,
  );
  if (!queue && !error) return null;
  return (
    <MiniPlayer
      label="Music player"
      track={
        queue && track
          ? {
              title: track.title,
              details: track.artist,
              href: queue.url,
              artwork: queue.artwork?.src,
            }
          : undefined
      }
      playing={active}
      onToggle={playback.toggle}
      repeatLabel="Repeat track"
      repeating={repeat}
      onRepeat={setRepeatPreference}
      seek={
        track && (
          <ReleaseSeek
            key={track.id}
            position={position}
            duration={duration}
            onSeek={playback.seek}
          />
        )
      }
    >
      {track && (
        <>
          {status === "loading" && <span role="status">Loading audio…</span>}
          {media && !(media instanceof BufferedAudio) && <span>Streaming</span>}
          {seeking && <span role="status">Seeking…</span>}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </MiniPlayer>
  );
}

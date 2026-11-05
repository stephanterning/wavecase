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
import { ReleasePlayback } from "./release-playback";
import { useMediaSession } from "./media-session";
import { BufferedAudio } from "./buffered-audio";
import { IconButton } from "./icon-button";
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
  const { playback, queue, index, status, error, repeat, seeking, media } =
    useReleasePlayer();
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
    undefined,
    {
      seek: playback.seek,
      previousTrack: playback.previousTrack,
      nextTrack:
        queue && index + 1 < queue.tracks.length
          ? playback.nextTrack
          : undefined,
    },
  );
  return (
    <>
      {(queue || error) && (
        <aside className="release-mini" aria-label="Music player">
          {queue && track && (
            <>
              <Link
                to={queue.url}
                className="release-mini-artwork"
                aria-label={`Open ${queue.title}`}
              >
                {queue.artwork ? (
                  <img src={queue.artwork.src} alt="" width={52} height={52} />
                ) : (
                  <span aria-hidden="true">♫</span>
                )}
              </Link>
              <div className="release-mini-description">
                <Link to={queue.url}>{track.title}</Link>
                <span>{track.artist}</span>
              </div>
              <IconButton
                className="icon-action play-toggle"
                icon={active ? "pause" : "play"}
                label={active ? "Pause" : "Play"}
                tooltip={active ? "Pause (Space)" : "Play (Space)"}
                aria-keyshortcuts="Space"
                onClick={playback.toggle}
              />
              <IconButton
                className="icon-action"
                icon="repeat"
                label="Repeat track"
                tooltip={repeat ? "Repeat track on" : "Repeat track off"}
                aria-pressed={repeat}
                onClick={() => playback.setRepeat(!repeat)}
              />
              {status === "loading" && (
                <span role="status">Loading audio…</span>
              )}
              {media && !(media instanceof BufferedAudio) && (
                <span>Streaming</span>
              )}
              {seeking && <span role="status">Seeking…</span>}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </aside>
      )}
    </>
  );
}

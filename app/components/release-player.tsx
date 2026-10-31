import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { ReleasePlayback } from "./release-playback";
import { useMediaSession } from "./media-session";
import { Icon } from "./icons";

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
  const { playback, queue, index, status, error } = useReleasePlayer();
  const audio = useRef<HTMLAudioElement>(null);
  const track = queue?.tracks[index];
  const active = status === "playing" || status === "loading";
  useEffect(() => {
    if (audio.current) return playback.attach(audio.current);
  }, [playback]);
  useMediaSession(
    audio,
    {
      title: track?.title,
      artist: track?.artist,
      album: queue?.title,
      artwork: queue?.artwork,
    },
    () => playback.fail(),
    playback.play,
  );
  return (
    <>
      <audio ref={audio} preload="none" hidden />
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
              <button
                type="button"
                className="icon-action play-toggle"
                aria-label={active ? "Pause" : "Play"}
                onClick={playback.toggle}
              >
                <Icon name={active ? "pause" : "play"} />
              </button>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </aside>
      )}
    </>
  );
}

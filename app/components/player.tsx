import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type RefObject,
} from "react";
import WaveSurfer from "wavesurfer.js";
import { observeListening } from "./listening";
import { Icon } from "./icons";
import { useMediaSession } from "./media-session";
import {
  disconnectPlaybackAudio,
  playbackGainDb,
  playNormalized,
} from "./playback-audio";
import {
  attachWaveformGestures,
  type CommentSelection,
} from "./waveform-gestures";
export type Playback = { position: number; playing: boolean };
const clock = (time: number) =>
  `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}`;
export function Player({
  url,
  peaks,
  duration,
  title,
  artist,
  artwork,
  metadata,
  share,
  versionId,
  playbackRef,
  audioRef,
  repeat,
  onRepeatChange,
  onComment,
}: {
  url: string;
  peaks: number[];
  duration: number;
  title: string;
  artist: string;
  artwork?: string;
  metadata: Record<string, unknown> | null;
  share?: string;
  versionId: string;
  playbackRef: RefObject<Playback>;
  audioRef: RefObject<HTMLAudioElement | null>;
  repeat: boolean;
  onRepeatChange: (repeat: boolean) => void;
  onComment?: (selection: CommentSelection) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const initialPeaks = useRef(peaks);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const gainDb = playbackGainDb(metadata);
  useMediaSession(
    audioRef,
    {
      title,
      artist,
      artwork: artwork ? { src: artwork, type: "image/jpeg" } : null,
    },
    () => setError("Audio could not play. Please try again."),
    () =>
      audioRef.current
        ? playNormalized(audioRef.current, gainDb)
        : Promise.resolve(),
  );
  const comment = useEffectEvent((selection: CommentSelection) =>
    onComment?.(selection),
  );
  const ended = useEffectEvent(() => {
    const media = audioRef.current;
    if (repeat && media) {
      media.currentTime = 0;
      void playNormalized(media, gainDb).catch(() =>
        setError("Press Play to continue playback."),
      );
    }
  });
  const canComment = !!onComment;
  useEffect(() => {
    const media = audioRef.current,
      element = container.current;
    if (!element || !media) return;
    const wave = WaveSurfer.create({
      container: element,
      media,
      peaks: [initialPeaks.current],
      duration,
      waveColor: "#8b9995",
      progressColor: "#bcebd6",
      cursorColor: "#ffffff",
      height: 220,
      normalize: true,
      interact: false,
      dragToSeek: false,
      autoScroll: false,
      autoCenter: false,
    });
    const stopGestures = attachWaveformGestures(
      element,
      wave,
      media,
      duration,
      canComment ? (selection) => comment(selection) : undefined,
    );
    const stop = share ? observeListening(media, versionId, share) : () => {};
    const remember = () => {
      playbackRef.current.position = media.currentTime;
      setPosition(media.currentTime);
    };
    const play = () => {
      playbackRef.current.playing = true;
      setPlaying(true);
      setError("");
    };
    const pause = () => {
      playbackRef.current.playing = false;
      setPlaying(false);
    };
    const restore = () => {
      media.currentTime =
        playbackRef.current.position < duration
          ? playbackRef.current.position
          : 0;
      media.loop = false;
      if (playbackRef.current.playing)
        void playNormalized(media, gainDb).catch(() =>
          setError("Press Play to continue playback."),
        );
    };
    const toggle = () => {
      if (media.paused)
        void playNormalized(media, gainDb).catch(() =>
          setError("Audio could not play. Please try again."),
        );
      else media.pause();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.code !== "Space" && event.key !== " ") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.closest("input, textarea, select, dialog, [role='textbox']"))
      )
        return;
      event.preventDefault();
      if (!event.repeat) toggle();
    };
    const finish = () => ended();
    const fail = () =>
      setError(
        "Audio could not be loaded. Please reload the page or try another version.",
      );
    media.addEventListener("ended", finish);
    media.addEventListener("loadedmetadata", restore, { once: true });
    media.addEventListener("timeupdate", remember);
    media.addEventListener("play", play);
    media.addEventListener("pause", pause);
    media.addEventListener("error", fail);
    if (media.readyState >= 1) restore();
    const revoke = () => {
      media.pause();
      disconnectPlaybackAudio(media);
      media.removeAttribute("src");
      media.load();
    };
    window.addEventListener("wavecase-access-revoked", revoke);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      window.removeEventListener("wavecase-access-revoked", revoke);
      window.removeEventListener("keydown", keyboard, true);
      media.removeEventListener("ended", finish);
      media.removeEventListener("loadedmetadata", restore);
      media.removeEventListener("timeupdate", remember);
      media.removeEventListener("play", play);
      media.removeEventListener("pause", pause);
      media.removeEventListener("error", fail);
      stopGestures();
      stop();
      wave.destroy();
      media.pause();
      disconnectPlaybackAudio(media);
      media.removeAttribute("src");
      media.load();
    };
  }, [
    audioRef,
    playbackRef,
    duration,
    canComment,
    share,
    url,
    versionId,
    gainDb,
  ]);
  return (
    <>
      <div
        ref={container}
        className="waveform"
        tabIndex={0}
        role="slider"
        aria-label="Waveform"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={position}
        aria-valuetext={`${clock(position)} of ${clock(duration)}`}
        aria-describedby="waveform-help"
      />
      <p className="waveform-help" id="waveform-help">
        Scroll or pinch to zoom · Drag to pan
        {canComment && " · Right-click or hold to comment"}
      </p>
      <audio ref={audioRef} src={url} preload="metadata" hidden />
      <div
        className="player-controls"
        role="group"
        aria-label="Playback controls"
      >
        <span
          className="tooltip"
          data-tooltip={playing ? "Pause (Space)" : "Play (Space)"}
        >
          <button
            type="button"
            className="icon-action play-toggle"
            aria-label={playing ? "Pause" : "Play"}
            onClick={() => {
              const media = audioRef.current;
              if (media?.paused)
                void playNormalized(media, gainDb).catch(() =>
                  setError("Audio could not play. Please try again."),
                );
              else media?.pause();
            }}
          >
            <Icon name={playing ? "pause" : "play"} />
          </button>
        </span>
        <output className="playback-time" aria-label="Playback time">
          {clock(position)} / {clock(duration)}
        </output>
        <span
          className="tooltip"
          data-tooltip={repeat ? "Repeat on" : "Repeat off"}
        >
          <button
            type="button"
            className="icon-action"
            aria-label="Repeat"
            aria-pressed={repeat}
            onClick={() => onRepeatChange(!repeat)}
          >
            <Icon name="repeat" />
          </button>
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

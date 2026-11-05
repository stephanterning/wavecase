import { attachAudioCacheSession } from "./compressed-audio-cache";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useSyncExternalStore,
  useState,
  type RefObject,
} from "react";
import WaveSurfer from "wavesurfer.js";
import { observeListening } from "./listening";
import { Icon } from "./icons";
import { useMediaSession } from "./media-session";
import { playbackGainDb } from "./playback-audio";
import { BufferedAudio } from "./buffered-audio";
import { useWorkspacePlayback } from "./workspace-player";
import { DemoPlayback } from "./demo-playback";
import {
  attachWaveformGestures,
  type CommentSelection,
} from "./waveform-gestures";
import { formatClock } from "../domain/format";
export type Playback = {
  position: number;
  playing: boolean;
  versionId?: string;
};
export function Player({
  trackId,
  versionName,
  url,
  revision,
  availableSources,
  seekRequest,
  peaks,
  duration,
  title,
  artist,
  artwork,
  metadata,
  share,
  versionId,
  playbackRef,
  repeat: localRepeat,
  onRepeatChange,
  onComment,
}: {
  trackId?: string;
  versionName?: string;
  url: string;
  revision: string;
  availableSources: string;
  seekRequest: { versionId: string; position: number } | null;
  peaks: number[];
  duration: number;
  title: string;
  artist: string;
  artwork?: string;
  metadata: Record<string, unknown> | null;
  share?: string;
  versionId: string;
  playbackRef: RefObject<Playback>;
  repeat: boolean;
  onRepeatChange: (repeat: boolean) => void;
  onComment?: (selection: CommentSelection) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const workspace = useWorkspacePlayback();
  const [playback] = useState(() =>
    workspace && trackId ? workspace.forTrack(trackId) : new DemoPlayback(),
  );
  const {
    media,
    source,
    loading,
    starting,
    repeating,
    error: loadError,
  } = useSyncExternalStore(
    playback.subscribe,
    playback.getSnapshot,
    playback.getSnapshot,
  );
  const repeat = workspace ? repeating : localRepeat;
  const startPlayback = useCallback(() => {
    if (workspace && trackId) workspace.activate(playback, trackId);
    return playback.play();
  }, [workspace, trackId, playback]);
  const [playing, setPlaying] = useState(false);
  const active = playing || starting;
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const [seeking, setSeeking] = useState(false);
  const gainDb = playbackGainDb(metadata);
  const select = () =>
    playback.select({
      key: versionId + revision,
      trackId,
      versionName,
      versionId,
      url,
      duration,
      gainDb,
      peaks,
      title,
      artist,
      artwork,
      share,
    });
  const selectLatest = useEffectEvent(select);
  useEffect(() => {
    playback.reconcile(availableSources.split(","));
    void selectLatest();
  }, [
    playback,
    versionId,
    revision,
    url,
    gainDb,
    availableSources,
    title,
    artist,
    artwork,
    versionName,
  ]);
  useEffect(() => {
    if (seekRequest) playback.seek(seekRequest.versionId, seekRequest.position);
  }, [playback, seekRequest]);
  useEffect(() => {
    if (!workspace) playback.setRepeat(localRepeat);
  }, [playback, localRepeat, workspace]);
  useEffect(() => {
    const clearCache = workspace ? undefined : attachAudioCacheSession();
    const revoke = () => playback.dispose();
    window.addEventListener("wavecase-access-revoked", revoke);
    return () => {
      window.removeEventListener("wavecase-access-revoked", revoke);
      if (workspace) workspace.release(playback);
      else playback.dispose();
      clearCache?.();
    };
  }, [playback, workspace]);
  useMediaSession(
    workspace ? null : media,
    {
      title: source?.title,
      artist: source?.artist,
      artwork: source?.artwork
        ? { src: source.artwork, type: "image/jpeg" }
        : null,
    },
    () => setError("Audio could not play. Please try again."),
    playback.play,
    playback.pause,
  );
  const comment = useEffectEvent((selection: CommentSelection) => {
    if (!loading && source?.versionId === versionId) onComment?.(selection);
  });
  const canComment = !!onComment;
  useEffect(() => {
    const element = container.current;
    if (!element || !media || !source) return;
    const colors = getComputedStyle(element);
    const wave = WaveSurfer.create({
      container: element,
      ...(media instanceof BufferedAudio ? {} : { media }),
      peaks: [source.peaks],
      duration: source.duration,
      waveColor: colors.getPropertyValue("--color-waveform"),
      progressColor: colors.getPropertyValue("--color-waveform-progress"),
      cursorColor: colors.getPropertyValue("--color-text-strong"),
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
      source.duration,
      canComment ? (selection) => comment(selection) : undefined,
    );
    const versionChanged =
      playbackRef.current.versionId !== undefined &&
      playbackRef.current.versionId !== source.versionId;
    playbackRef.current.versionId = source.versionId;
    const stop = source.share
      ? observeListening(media, source.versionId, source.share, versionChanged)
      : undefined;
    const remember = () => {
      if (media instanceof BufferedAudio) wave.setTime(media.currentTime);
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
    const seek = () => setSeeking(true);
    const seeked = () => setSeeking(false);
    remember();
    seeked();
    if (media.paused) pause();
    else play();
    const toggle = () => {
      if (media.paused)
        void startPlayback().catch(() =>
          setError("Audio could not play. Please try again."),
        );
      else playback.pause();
    };
    const keyboard = (event: KeyboardEvent) => {
      const shared = workspace?.getSnapshot().playback?.getSnapshot();
      if (shared?.source || shared?.loading) return;
      if (event.defaultPrevented || event.isComposing || event.shiftKey) return;
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
    const fail = () =>
      setError(
        "Audio could not be loaded. Please reload the page or try another version.",
      );
    media.addEventListener("timeupdate", remember);
    media.addEventListener("play", play);
    media.addEventListener("pause", pause);
    media.addEventListener("error", fail);
    media.addEventListener("wavecase-user-seek", seek);
    media.addEventListener("wavecase-user-seeked", seeked);
    window.addEventListener("keydown", keyboard, true);
    return () => {
      window.removeEventListener("keydown", keyboard, true);
      media.removeEventListener("timeupdate", remember);
      media.removeEventListener("play", play);
      media.removeEventListener("pause", pause);
      media.removeEventListener("error", fail);
      media.removeEventListener("wavecase-user-seek", seek);
      media.removeEventListener("wavecase-user-seeked", seeked);
      stopGestures();
      stop?.();
      wave.destroy();
    };
  }, [
    media,
    source,
    playback,
    playbackRef,
    canComment,
    workspace,
    startPlayback,
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
        aria-valuemax={source?.duration ?? duration}
        aria-valuenow={position}
        aria-valuetext={`${formatClock(position)} of ${formatClock(source?.duration ?? duration)}`}
        aria-describedby="waveform-help"
      />
      <p className="waveform-help" id="waveform-help">
        Scroll or pinch to zoom · Drag to pan
        {canComment && " · Right-click or hold to comment"}
      </p>
      {loading && (
        <p role="status">
          {playing
            ? "Loading selected version. The previous version is still playing."
            : "Loading audio…"}
        </p>
      )}
      {media && !(media instanceof BufferedAudio) && (
        <p>This browser uses native audio playback.</p>
      )}
      {seeking && <p role="status">Seeking…</p>}
      {loadError && (
        <p role="alert">
          {loadError}{" "}
          <button type="button" onClick={() => void select()}>
            Retry
          </button>
        </p>
      )}
      <div
        className="player-controls"
        role="group"
        aria-label="Playback controls"
      >
        <span
          className="tooltip"
          data-tooltip={active ? "Pause (Space)" : "Play (Space)"}
        >
          <button
            type="button"
            className="icon-action play-toggle"
            aria-label={active ? "Pause" : "Play"}
            onClick={() => {
              if (!active)
                void startPlayback().catch(() =>
                  setError("Audio could not play. Please try again."),
                );
              else playback.pause();
            }}
          >
            <Icon name={active ? "pause" : "play"} />
          </button>
        </span>
        <output className="playback-time" aria-label="Playback time">
          {formatClock(position)} / {formatClock(source?.duration ?? duration)}
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
            onClick={() =>
              workspace ? playback.setRepeat(!repeat) : onRepeatChange(!repeat)
            }
          >
            <Icon name="repeat" />
          </button>
        </span>
      </div>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

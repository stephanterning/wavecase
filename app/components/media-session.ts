import { experimentalPlaybackOutput } from "./audio-context";
import { logAudio, observeAudioPromise } from "./audio-diagnostics";
import type { PlaybackMedia } from "./playback-audio";
import { useEffect, useEffectEvent } from "react";

export function attachMediaSession(
  media: PlaybackMedia,
  metadata: MediaMetadataInit,
  onError: () => void,
  onPlay: () => Promise<void> = () => media.play(),
  onPause: () => void = () => media.pause(),
) {
  if (!("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  const description =
    typeof MediaMetadata !== "undefined" ? new MediaMetadata(metadata) : null;
  const clearPosition = () => {
    try {
      session.setPositionState?.();
    } catch {
      // Position reporting is optional in browsers with partial API support.
    }
  };
  const handlers: Partial<
    Record<MediaSessionAction, MediaSessionActionHandler | null>
  > = {
    play: () => void observeAudioPromise("remote.play", onPlay).catch(onError),
    pause: () => {
      logAudio("remote.pause");
      onPause();
    },
    seekto: null,
    seekbackward: null,
    seekforward: null,
    previoustrack: null,
    nexttrack: null,
  };
  const setHandlers = (clear = false) => {
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(
          action as MediaSessionAction,
          clear ? null : handler,
        );
      } catch {
        // Browsers may implement only part of the Media Session action set.
      }
    }
  };
  // Discard any timeline left by an earlier player; never publish track time.
  clearPosition();
  setHandlers();
  logAudio("mediaSession.attached");
  const output = experimentalPlaybackOutput();
  let attached = true;
  const outputError = (error: unknown) => {
    if (
      attached &&
      !(error instanceof DOMException && error.name === "AbortError")
    )
      onError();
  };
  const outputPlay = () => {
    if (output && !output.paused && media.paused)
      void observeAudioPromise("output.transportPlay", onPlay).catch(
        outputError,
      );
  };
  const outputPause = () => {
    if (output?.paused && !media.paused) onPause();
  };
  output?.addEventListener("play", outputPlay);
  output?.addEventListener("pause", outputPause);
  output?.addEventListener("error", outputError);
  const resumeOutput = () => {
    if (output?.paused && !media.paused)
      void observeAudioPromise("output.syncPlay", () => output.play()).catch(
        outputError,
      );
  };
  media.addEventListener("play", resumeOutput);
  const pauseOutput = () => {
    if (media.paused || media.ended || media.error) output?.pause();
  };
  const outputStops = ["pause", "ended", "error"] as const;
  for (const event of outputStops) media.addEventListener(event, pauseOutput);
  const updateState = () => {
    session.metadata = media.error ? null : description;
    session.playbackState = media.error
      ? "none"
      : !media.paused && !media.ended
        ? "playing"
        : "paused";
  };
  const events = ["play", "pause", "ended", "error", "loadedmetadata"] as const;
  for (const event of events) media.addEventListener(event, updateState);
  updateState();
  const diagnosticEvents = [
    "play",
    "playing",
    "pause",
    "waiting",
    "ended",
    "error",
  ] as const;
  const record = (event: Event) =>
    logAudio(`media.${event.type}`, {
      paused: media.paused,
      ended: media.ended,
      seeking: media.seeking,
    });
  for (const event of diagnosticEvents) media.addEventListener(event, record);
  const stop = () => {
    attached = false;
    logAudio("mediaSession.detached");
    media.removeEventListener("play", resumeOutput);
    for (const event of outputStops)
      media.removeEventListener(event, pauseOutput);
    output?.removeEventListener("play", outputPlay);
    output?.removeEventListener("pause", outputPause);
    output?.removeEventListener("error", outputError);
    for (const event of diagnosticEvents)
      media.removeEventListener(event, record);
    for (const event of events) media.removeEventListener(event, updateState);
    window.removeEventListener("wavecase-access-revoked", stop);
    session.metadata = null;
    session.playbackState = "none";
    clearPosition();
    setHandlers(true);
  };
  window.addEventListener("wavecase-access-revoked", stop);
  return stop;
}

export function useMediaSession(
  media: PlaybackMedia | null,
  {
    title,
    artist = "",
    album = "",
    artwork,
  }: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: MediaImage | null;
  },
  onError: () => void,
  onPlay: () => Promise<void>,
  onPause?: () => void,
) {
  const fail = useEffectEvent(onError);
  const play = useEffectEvent(onPlay);
  const pause = useEffectEvent(() => (onPause ? onPause() : media?.pause()));
  const { src, sizes, type } = artwork ?? {};
  useEffect(() => {
    if (!media || title === undefined) return;
    return attachMediaSession(
      media,
      { title, artist, album, artwork: src ? [{ src, sizes, type }] : [] },
      () => fail(),
      () => play(),
      () => pause(),
    );
  }, [media, title, artist, album, src, sizes, type]);
}

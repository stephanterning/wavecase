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
    play: () => void onPlay().catch(onError),
    pause: onPause,
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
  const stop = () => {
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

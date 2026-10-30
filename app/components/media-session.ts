import { useEffect, useEffectEvent, type RefObject } from "react";

export function attachMediaSession(
  media: HTMLAudioElement,
  metadata: MediaMetadataInit,
  onError: () => void,
) {
  if (!("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  const description =
    typeof MediaMetadata !== "undefined" ? new MediaMetadata(metadata) : null;
  const handlers = {
    play: () => void media.play().catch(onError),
    pause: () => media.pause(),
    seekto: (details: MediaSessionActionDetails) => {
      if (details.seekTime !== undefined) media.currentTime = details.seekTime;
    },
  };
  for (const action of Object.keys(handlers) as (keyof typeof handlers)[]) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // Browsers may implement only part of the Media Session action set.
    }
  }
  const updateState = () => {
    if (media.error) {
      session.metadata = null;
      session.playbackState = "none";
      return;
    }
    if (session.metadata !== description) session.metadata = description;
    session.playbackState = media.paused || media.ended ? "paused" : "playing";
  };
  const events = ["play", "playing", "pause", "ended", "error"] as const;
  for (const event of events) media.addEventListener(event, updateState);
  updateState();
  const stop = () => {
    for (const event of events) media.removeEventListener(event, updateState);
    window.removeEventListener("wavecase-access-revoked", stop);
    session.metadata = null;
    session.playbackState = "none";
    for (const action of Object.keys(handlers) as (keyof typeof handlers)[]) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Unsupported action.
      }
    }
  };
  window.addEventListener("wavecase-access-revoked", stop);
  return stop;
}

export function useMediaSession(
  audioRef: RefObject<HTMLAudioElement | null>,
  {
    title,
    artist = "",
    album = "",
    artwork,
  }: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: string | null;
  },
  onError: () => void,
) {
  const fail = useEffectEvent(onError);
  useEffect(() => {
    const media = audioRef.current;
    if (!media || title === undefined) return;
    return attachMediaSession(
      media,
      { title, artist, album, artwork: artwork ? [{ src: artwork }] : [] },
      () => fail(),
    );
  }, [audioRef, title, artist, album, artwork]);
}

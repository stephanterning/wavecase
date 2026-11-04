import type { PlaybackMedia } from "./playback-audio";
import { useEffect, useEffectEvent } from "react";
import { seekPlayback } from "./playback-audio";

type MediaSessionControls = {
  seek?: (position: number) => void;
  previousTrack?: () => void;
  nextTrack?: () => void;
};

export function attachMediaSession(
  media: PlaybackMedia,
  metadata: MediaMetadataInit,
  onError: () => void,
  onPlay: () => Promise<void> = () => media.play(),
  onPause: () => void = () => media.pause(),
  controls: MediaSessionControls = {},
) {
  if (!("mediaSession" in navigator)) return () => {};
  const session = navigator.mediaSession;
  const description =
    typeof MediaMetadata !== "undefined" ? new MediaMetadata(metadata) : null;
  const updatePosition = (clear = false) => {
    if (typeof session.setPositionState !== "function") return;
    const { duration, currentTime, playbackRate } = media;
    try {
      if (
        clear ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(currentTime) ||
        !Number.isFinite(playbackRate) ||
        playbackRate === 0
      )
        session.setPositionState();
      else
        session.setPositionState({
          duration,
          position: Math.max(0, Math.min(currentTime, duration)),
          playbackRate,
        });
    } catch {
      // Position reporting is optional in browsers with partial API support.
    }
  };
  const seek = (position: number) => {
    if (
      media.error ||
      !Number.isFinite(position) ||
      !Number.isFinite(media.duration) ||
      media.duration <= 0
    )
      return;
    const next = Math.max(0, Math.min(position, media.duration));
    if (controls.seek) controls.seek(next);
    else seekPlayback(media, next);
    updatePosition();
  };
  // Queue navigation replaces skip controls so platforms can show previous/next.
  const hasQueue = !!controls.previousTrack;
  const handlers = {
    play: () => void onPlay().catch(onError),
    pause: onPause,
    seekto: (details: MediaSessionActionDetails) => {
      if (details.seekTime !== undefined) seek(details.seekTime);
    },
    seekbackward: hasQueue
      ? null
      : (details: MediaSessionActionDetails) =>
          seek(media.currentTime - (details.seekOffset ?? 10)),
    seekforward: hasQueue
      ? null
      : (details: MediaSessionActionDetails) =>
          seek(media.currentTime + (details.seekOffset ?? 10)),
    previoustrack: controls.previousTrack ?? null,
    nexttrack: controls.nextTrack ?? null,
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
      updatePosition(true);
      return;
    }
    if (session.metadata !== description) session.metadata = description;
    session.playbackState = media.paused || media.ended ? "paused" : "playing";
    updatePosition();
  };
  const events = [
    "play",
    "playing",
    "pause",
    "ended",
    "error",
    "loadedmetadata",
    "durationchange",
    "timeupdate",
    "seeking",
    "seeked",
    "wavecase-user-seeked",
    "ratechange",
    "emptied",
  ] as const;
  for (const event of events) media.addEventListener(event, updateState);
  updateState();
  const stop = () => {
    for (const event of events) media.removeEventListener(event, updateState);
    window.removeEventListener("wavecase-access-revoked", stop);
    session.metadata = null;
    session.playbackState = "none";
    updatePosition(true);
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
  { seek, previousTrack, nextTrack }: MediaSessionControls = {},
) {
  const fail = useEffectEvent(onError);
  const play = useEffectEvent(onPlay);
  const pause = useEffectEvent(() => (onPause ? onPause() : media?.pause()));
  const seekTo = useEffectEvent((position: number) => seek?.(position));
  const previous = useEffectEvent(() => previousTrack?.());
  const next = useEffectEvent(() => nextTrack?.());
  const canSeek = !!seek;
  const canPrevious = !!previousTrack;
  const canNext = !!nextTrack;
  const { src, sizes, type } = artwork ?? {};
  useEffect(() => {
    if (!media || title === undefined) return;
    return attachMediaSession(
      media,
      { title, artist, album, artwork: src ? [{ src, sizes, type }] : [] },
      () => fail(),
      () => play(),
      () => pause(),
      {
        seek: canSeek ? (position) => seekTo(position) : undefined,
        previousTrack: canPrevious ? () => previous() : undefined,
        nextTrack: canNext ? () => next() : undefined,
      },
    );
  }, [
    media,
    title,
    artist,
    album,
    src,
    sizes,
    type,
    canSeek,
    canPrevious,
    canNext,
  ]);
}

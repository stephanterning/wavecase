import { BufferedAudio } from "./buffered-audio";
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
  // Native files own their platform timeline. Worklets are not media elements,
  // so other browsers still need their actual transport position and state.
  const buffered = media instanceof BufferedAudio;
  let stalled = false;
  let advancing = false;
  const updatePosition = (clear = false) => {
    if (!buffered || typeof session.setPositionState !== "function") return;
    const { duration, currentTime, playbackRate } = media;
    try {
      if (
        clear ||
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !Number.isFinite(currentTime) ||
        !Number.isFinite(playbackRate) ||
        playbackRate <= 0
      )
        session.setPositionState();
      else
        session.setPositionState({
          duration,
          position: Math.max(0, Math.min(currentTime, duration)),
          playbackRate: advancing ? playbackRate : 1e-6,
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
    const next = Math.max(
      0,
      Math.min(
        position,
        Number.isFinite(media.duration) ? media.duration : position,
      ),
    );
    if (controls.seek) controls.seek(next);
    else seekPlayback(media, next);
    updatePosition();
  };
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
  const actions = Object.keys(handlers) as (keyof typeof handlers)[];
  for (const action of actions) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      /* Partial Media Session support. */
    }
  }
  const updateMetadata = (event?: Event) => {
    const failed = !!media.error || event?.type === "error";
    session.metadata = failed ? null : description;
    if (buffered) {
      // Preserve explicit reporting for the existing non-native transport.
      // Safari's file element never enters this branch.
      if (event?.type === "waiting") stalled = true;
      else if (["playing", "pause", "emptied"].includes(event?.type ?? ""))
        stalled = false;
      const playing = !failed && !media.paused && !media.ended;
      const wasAdvancing = advancing;
      advancing = playing && !stalled;
      updatePosition(failed);
      if (
        playing &&
        session.playbackState === "playing" &&
        (advancing !== wasAdvancing || event?.type === "wavecase-loop")
      ) {
        session.playbackState = "paused";
        session.playbackState = "playing";
      } else
        session.playbackState = failed
          ? "none"
          : playing
            ? "playing"
            : "paused";
    }
  };
  const events = buffered
    ? [
        "play",
        "playing",
        "waiting",
        "pause",
        "ended",
        "error",
        "loadedmetadata",
        "durationchange",
        "timeupdate",
        "seeking",
        "seeked",
        "wavecase-loop",
        "ratechange",
        "emptied",
      ]
    : ["play", "loadedmetadata", "error"];
  for (const event of events) media.addEventListener(event, updateMetadata);
  updateMetadata();
  const stop = () => {
    for (const event of events)
      media.removeEventListener(event, updateMetadata);
    window.removeEventListener("wavecase-access-revoked", stop);
    session.metadata = null;
    if (buffered) {
      session.playbackState = "none";
      updatePosition(true);
    }
    for (const action of actions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        /* Unsupported action. */
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

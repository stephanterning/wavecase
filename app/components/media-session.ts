import type { PlaybackMedia } from "./playback-audio";
import { useEffect, useEffectEvent } from "react";
import { seekPlayback } from "./playback-audio";

const frozenRate = 1e-6;

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
  let stalled = false;
  let advancing = false;
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
          // WebKit Now Playing extrapolates with this rate while its session
          // plays: the output element during a stall, or a direct AudioContext
          // even when paused. Zero is rejected, so a negligible rate freezes it.
          playbackRate: advancing ? playbackRate : frozenRate,
        });
    } catch {
      // Position reporting is optional in browsers with partial API support.
    }
  };
  // WebKit refreshes a direct AudioContext's Now Playing only on a playback-state
  // change or a timer of several seconds; the media-element output refreshes on
  // position changes, where this is redundant but harmless.
  const announce = () => {
    session.playbackState = "paused";
    session.playbackState = "playing";
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
    seekbackward: hasQueue ? null : () => seek(0),
    seekforward: hasQueue
      ? null
      : (details: MediaSessionActionDetails) =>
          seek(media.currentTime + (details.seekOffset ?? 10)),
    previoustrack: controls.previousTrack ?? (() => seek(0)),
    nexttrack: controls.nextTrack ?? null,
  };
  const seekActions = ["seekto", "seekbackward", "seekforward"] as const;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const refreshSeeking = () => {
    if (navigator.vendor !== "Apple Computer, Inc.") return;
    // WebKit 326021: commands registered before Now Playing becomes seekable
    // can stay disabled. Change the command set across tasks after playback
    // starts; replacing a handler without removing it does not refresh it.
    // https://bugs.webkit.org/show_bug.cgi?id=326021
    clearTimeout(refreshTimer);
    for (const action of seekActions) {
      try {
        session.setActionHandler(action, null);
      } catch {
        // Partial Media Session support.
      }
    }
    refreshTimer = setTimeout(() => {
      for (const action of seekActions) {
        try {
          session.setActionHandler(action, handlers[action]);
        } catch {
          // Partial Media Session support.
        }
      }
    }, 100);
  };
  for (const action of Object.keys(handlers) as (keyof typeof handlers)[]) {
    try {
      session.setActionHandler(action, handlers[action]);
    } catch {
      // Browsers may implement only part of the Media Session action set.
    }
  }
  const updateState = (event?: Event) => {
    if (event?.type === "waiting") stalled = true;
    else if (["playing", "pause", "emptied"].includes(event?.type ?? ""))
      stalled = false;
    if (media.error) {
      advancing = false;
      session.metadata = null;
      session.playbackState = "none";
      updatePosition(true);
      return;
    }
    if (session.metadata !== description) session.metadata = description;
    const playing = !media.paused && !media.ended;
    const wasAdvancing = advancing;
    advancing = playing && !stalled;
    // Report the position first; WebKit samples it on the state change.
    updatePosition();
    if (
      playing &&
      session.playbackState === "playing" &&
      (advancing !== wasAdvancing || event?.type === "wavecase-loop")
    )
      announce();
    else session.playbackState = playing ? "playing" : "paused";
    if (event?.type === "playing") refreshSeeking();
  };
  const events = [
    "play",
    "playing",
    "waiting",
    "wavecase-loop",
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
  if (!media.paused && !media.ended) refreshSeeking();
  const stop = () => {
    clearTimeout(refreshTimer);
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

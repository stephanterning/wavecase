import Hls from "hls.js";

// Every player uses an ordinary audio element fed by prepared HLS. The copies
// already carry the normalized samples, so no client gain is applied.
export type PlaybackMedia = HTMLAudioElement;

type Transport = {
  hls?: Hls;
  url?: string;
  failed?: boolean;
  attempt?: object;
};
const transports = new WeakMap<HTMLAudioElement, Transport>();
const seeks = new WeakMap<HTMLAudioElement, AbortController>();

export function createPlaybackMedia(): PlaybackMedia {
  return new Audio();
}

export function setPlaybackSource(media: PlaybackMedia, source: string) {
  transports.get(media)?.hls?.destroy();
  const state: Transport = { url: source };
  transports.set(media, state);
  const url = new URL(source, window.location.href);
  const canPlayNative = !!media.canPlayType("application/vnd.apple.mpegurl");
  // Apple's native player owns buffering, background playback and Now Playing.
  // Other browsers, including Android Chrome, may also claim native HLS but
  // get the more predictable hls.js path whenever MSE is available.
  const native =
    canPlayNative &&
    (navigator.vendor === "Apple Computer, Inc." || !Hls.isSupported());
  // Prefer FLAC so Safari exercises lossless HLS. Browsers whose MSE cannot
  // decode it get the separately prepared AAC stream.
  const flac =
    native ||
    (typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported('audio/mp4; codecs="fLaC"'));
  url.searchParams.set("hls", flac ? "flac" : "aac");
  if (native || !Hls.isSupported()) {
    media.src = url.href;
    return;
  }
  // Chrome caps buffered audio near 12 MB, about 40 seconds of dense 24-bit
  // FLAC. Older segments come back from the HTTP cache when needed.
  const hls = new Hls({ maxBufferLength: 30, backBufferLength: 10 });
  state.hls = hls;
  hls.on(Hls.Events.ERROR, (_event, error) => {
    if (!error.fatal || transports.get(media) !== state) return;
    state.failed = true;
    media.pause();
    media.dispatchEvent(new Event("error"));
  });
  hls.attachMedia(media);
  hls.loadSource(url.href);
}

export function destroyPlaybackMedia(media: PlaybackMedia) {
  cancelPlaybackSeek(media);
  transports.get(media)?.hls?.destroy();
  transports.delete(media);
  media.pause();
  media.removeAttribute("src");
  media.load();
}

export async function playMedia(media: PlaybackMedia, silent = false) {
  let state = transports.get(media) ?? {};
  if ((state.failed || media.error) && state.url) {
    setPlaybackSource(media, state.url);
    state = transports.get(media)!;
  }
  const attempt = {};
  state.attempt = attempt;
  media.muted = silent;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail: () => void = () => {};
  const failed = new Promise<never>((_resolve, reject) => {
    fail = () => reject(new Error("Audio could not be loaded."));
    media.addEventListener("error", fail, { once: true });
    timer = setTimeout(
      () => reject(new Error("Audio startup timed out. Please try again.")),
      30000,
    );
  });
  try {
    // Call play synchronously so mobile Safari keeps the user gesture.
    await Promise.race([media.play(), failed]);
  } catch (error) {
    // A replaced source's rejected play must not pause its replacement.
    if (transports.get(media)?.attempt === attempt) {
      // A normal pause can reject an unfinished play without breaking HLS.
      if (!(error instanceof DOMException && error.name === "AbortError"))
        state.failed = true;
      media.pause();
    }
    throw error;
  } finally {
    clearTimeout(timer);
    media.removeEventListener("error", fail);
  }
}

/** Version changes cut directly: iOS does not let scripts fade media volume. */
export function switchPlayback(
  previous: PlaybackMedia | null,
  next: PlaybackMedia,
) {
  previous?.pause();
  next.muted = false;
}

/** Applies a start position once the element knows its timeline, unless the
 * listener seeks first. iOS may not load metadata before a play gesture.
 */
export function startPlaybackAt(media: PlaybackMedia, position: number) {
  if (media.readyState >= 1) {
    media.currentTime = position;
    return;
  }
  const controller = new AbortController();
  const options = { once: true, signal: controller.signal };
  media.addEventListener(
    "loadedmetadata",
    () => {
      controller.abort();
      media.currentTime = position;
    },
    options,
  );
  for (const name of ["wavecase-user-seek", "emptied"])
    media.addEventListener(name, () => controller.abort(), options);
}

export function cancelPlaybackSeek(media: PlaybackMedia) {
  seeks.get(media)?.abort();
  seeks.delete(media);
}

/** All user seeks go through this entry point, including lock-screen controls. */
export function seekPlayback(media: PlaybackMedia, position: number) {
  if (!Number.isFinite(position)) return;
  if (position === media.currentTime && !media.seeking && !seeks.has(media))
    return;
  seeks.get(media)?.abort();
  const controller = new AbortController();
  seeks.set(media, controller);
  media.dispatchEvent(new Event("wavecase-user-seek"));
  const finish = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    seeks.delete(media);
    media.dispatchEvent(new Event("wavecase-user-seeked"));
  };
  media.addEventListener("error", finish, { signal: controller.signal });
  media.addEventListener(
    "seeked",
    () => {
      if (!media.seeking) finish();
    },
    { signal: controller.signal },
  );
  media.currentTime = Math.max(
    0,
    Math.min(
      position,
      Number.isFinite(media.duration) ? media.duration : position,
    ),
  );
  if (!media.seeking) finish();
}

/** Native looping never fires ended. Emit a separate boundary event so a loop
 * counts as a new play, while an explicit seek to zero still does not.
 */
export function observePlaybackLoop(media: PlaybackMedia) {
  let last = media.currentTime;
  let userSeek = false;
  const seeking = () => {
    if (media.loop && !userSeek && media.currentTime < last && !media.paused)
      media.dispatchEvent(new Event("wavecase-loop"));
    last = media.currentTime;
  };
  const seeked = () => {
    userSeek = false;
    last = media.currentTime;
  };
  const manual = () => {
    userSeek = true;
  };
  const reset = () => {
    last = 0;
    userSeek = false;
  };
  const events = {
    timeupdate: seeking,
    seeking,
    seeked,
    "wavecase-user-seek": manual,
    "wavecase-user-seeked": seeked,
    emptied: reset,
    loadstart: reset,
    ended: reset,
  };
  for (const [name, listener] of Object.entries(events))
    media.addEventListener(name, listener);
  return () => {
    for (const [name, listener] of Object.entries(events))
      media.removeEventListener(name, listener);
  };
}

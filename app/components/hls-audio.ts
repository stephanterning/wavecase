import Hls from "hls.js";
import type { PlaybackMedia } from "./playback-audio";

type Transport = {
  hls?: Hls;
  url?: string;
  failed?: boolean;
  attempt?: object;
};
const transports = new WeakMap<HTMLAudioElement, Transport>();

export function createHlsMedia(duration: number): PlaybackMedia {
  // Duration remains part of the factory contract used by the controllers.
  void duration;
  const media = new Audio();
  transports.set(media, {});
  return media;
}
export function isHlsMedia(
  media: PlaybackMedia,
): media is HTMLAudioElement & { readonly __hls: unique symbol } {
  return transports.has(media as HTMLAudioElement);
}
export function setPlaybackSource(media: PlaybackMedia, source: string) {
  if (!isHlsMedia(media)) {
    media.src = source;
    return;
  }
  const previous = transports.get(media)!;
  previous.hls?.destroy();
  const state: Transport = { url: source };
  transports.set(media, state);
  const url = new URL(source, window.location.href);
  const native = !!media.canPlayType("application/vnd.apple.mpegurl");
  // Prefer FLAC explicitly so the iPhone trial actually exercises lossless HLS.
  // Browsers whose MSE cannot decode it get the separately prepared AAC stream.
  const flac =
    native ||
    (typeof MediaSource !== "undefined" &&
      MediaSource.isTypeSupported('audio/mp4; codecs="fLaC"'));
  url.searchParams.set("hls", flac ? "flac" : "aac");
  if (native || !Hls.isSupported()) {
    media.src = url.href;
    return;
  }
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
export function destroyHls(media: HTMLAudioElement) {
  transports.get(media)?.hls?.destroy();
  transports.delete(media);
}

export async function playHls(media: HTMLAudioElement, silent: boolean) {
  let state = transports.get(media)!;
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
    // Synchronous play preserves the user gesture. No AudioContext or client
    // gain is involved: the HLS copies already carry the normalized samples.
    await Promise.race([media.play(), failed]);
  } catch (error) {
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

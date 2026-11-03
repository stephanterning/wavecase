// One context per page keeps it unlocked across version changes. Sources belong
// to media elements and must be reused if an effect reconnects the same element.
import { BufferedAudio } from "./buffered-audio";
import {
  playbackContext,
  resumePlayback,
  maxBufferBytes,
  transitionSeconds,
} from "./audio-context";
export { transitionSeconds } from "./audio-context";
export type PlaybackMedia = HTMLAudioElement | BufferedAudio;

export function createPlaybackMedia(duration: number): PlaybackMedia {
  const context = playbackContext();
  return duration > 0 && duration * context.sampleRate * 2 * 4 <= maxBufferBytes
    ? new BufferedAudio(context)
    : new Audio();
}
let context: AudioContext | undefined;
const sources = new WeakMap<
  HTMLAudioElement,
  {
    source: MediaElementAudioSourceNode;
    gain: GainNode;
    envelope: GainNode;
    connected: boolean;
  }
>();
const attempts = new WeakMap<HTMLAudioElement, object>();
const seeks = new WeakMap<HTMLAudioElement, AbortController>();

export function playbackGainDb(metadata: Record<string, unknown> | null) {
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const lufs = metadata?.lufs;
  const peak = metadata?.peak;
  const truePeak = metadata?.truePeak;
  const target = finite(lufs) ? -16 - lufs : 0;
  // Do not boost without both peak measurements. Silence/below-gate audio
  // has no integrated LUFS target. loudnorm rounds true peak to 0.01 dB.
  return Math.min(
    target,
    finite(peak) ? -peak : 0,
    finite(truePeak) ? -truePeak - 0.01 : 0,
  );
}

export async function playNormalized(
  media: PlaybackMedia,
  gainDb: number,
  silent = false,
) {
  if (media instanceof BufferedAudio) {
    media.setGain(gainDb);
    media.setAudible(!silent);
    return media.play();
  }
  const attempt = {};
  attempts.set(media, attempt);
  context = playbackContext();
  let graph = sources.get(media);
  if (!graph) {
    graph = {
      source: context.createMediaElementSource(media),
      gain: context.createGain(),
      envelope: context.createGain(),
      connected: false,
    };
    sources.set(media, graph);
  }
  graph.gain.gain.setValueAtTime(10 ** (gainDb / 20), context.currentTime);
  graph.envelope.gain.cancelScheduledValues(context.currentTime);
  graph.envelope.gain.setValueAtTime(silent ? 0 : 1, context.currentTime);
  if (!graph.connected) {
    graph.source.connect(graph.gain);
    graph.gain.connect(graph.envelope);
    graph.envelope.connect(context.destination);
    graph.connected = true;
  }
  try {
    // Start both synchronously in the user gesture, including on mobile Safari.
    await Promise.all([resumePlayback(context), media.play()]);
  } catch (error) {
    // A rejected play from a replaced source must not pause its replacement.
    if (attempts.get(media) === attempt) media.pause();
    throw error;
  }
}

export function cancelPlaybackSeek(media: PlaybackMedia) {
  if (media instanceof BufferedAudio) return;
  seeks.get(media)?.abort();
  seeks.delete(media);
}

export function disconnectPlaybackAudio(media: PlaybackMedia) {
  if (media instanceof BufferedAudio) return media.destroy();
  cancelPlaybackSeek(media);
  attempts.delete(media);
  const graph = sources.get(media);
  if (!graph) return;
  graph.source.disconnect();
  graph.gain.disconnect();
  graph.envelope.disconnect();
  graph.connected = false;
}

/** Schedule both sides on the audio clock; a delayed JS timer cannot add a gap. */
export function crossfadePlayback(
  previous: PlaybackMedia | null,
  next: PlaybackMedia,
) {
  const now = playbackContext().currentTime;
  for (const [media, from, to] of [
    [previous, 1, 0],
    [next, 0, 1],
  ] as const) {
    if (!media) continue;
    if (media instanceof BufferedAudio) {
      media.setAudible(to === 1, true, now);
      continue;
    }
    cancelPlaybackSeek(media);
    const gain = sources.get(media)?.envelope.gain;
    gain?.cancelScheduledValues(now);
    gain?.setValueAtTime(from, now);
    gain?.linearRampToValueAtTime(to, now + transitionSeconds);
  }
}

/** All user seeks go through this entry point, including lock-screen controls.
 * Buffered sources switch on the audio clock. The long-file streaming fallback
 * fades around the browser seek, but cannot flush Safari's media bridge queue.
 */
export function seekPlayback(media: PlaybackMedia, position: number) {
  if (!Number.isFinite(position)) return;
  if (media instanceof BufferedAudio) {
    media.currentTime = position;
    return;
  }
  if (position === media.currentTime && !media.seeking && !seeks.has(media))
    return;
  seeks.get(media)?.abort();
  const controller = new AbortController();
  seeks.set(media, controller);
  media.dispatchEvent(new Event("wavecase-user-seek"));
  const gain = sources.get(media)?.envelope.gain;
  const now = context?.currentTime ?? 0;
  gain?.cancelScheduledValues(now);
  gain?.setValueAtTime(gain.value, now);
  gain?.linearRampToValueAtTime(0, now + transitionSeconds);
  const finish = () => {
    if (controller.signal.aborted) return;
    const time = context?.currentTime ?? 0;
    gain?.setValueAtTime(0, time);
    gain?.linearRampToValueAtTime(1, time + transitionSeconds);
    controller.abort();
    seeks.delete(media);
    media.dispatchEvent(new Event("wavecase-user-seeked"));
  };
  media.addEventListener("error", finish, { signal: controller.signal });
  const commit = () => {
    // An older seek can finish during the fade-out. It must not cancel this
    // request's timer or mark its backward jump as a native loop.
    media.dispatchEvent(new Event("wavecase-user-seek"));
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
  };
  if (gain && !media.paused) {
    const timer = setTimeout(commit, transitionSeconds * 1000);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), {
      once: true,
    });
  } else commit();
}

/** Native looping never fires ended. Emit a separate boundary event so a loop
 * counts as a new play, while an explicit seek to zero still does not.
 */
export function observePlaybackLoop(media: PlaybackMedia) {
  if (media instanceof BufferedAudio) return () => {};
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

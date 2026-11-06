import {
  audioOutputMode,
  observeAudioOutput,
  logAudio,
  observeAudioContext,
  observeAudioPromise,
} from "./audio-diagnostics";
let context: AudioContext | undefined;
const outputs = new WeakMap<
  AudioContext,
  { destination: MediaStreamAudioDestinationNode; media: HTMLAudioElement }
>();

export function playbackDestination(context: AudioContext): AudioNode {
  // macOS Safari can queue about a second at the device destination even when
  // outputLatency reports milliseconds. Keep the gain/worklet graph, but let
  // a media element handle device output. Exclude iPads using desktop identity.
  const mode = audioOutputMode();
  if (
    mode === "direct" ||
    (mode !== "element" &&
      (navigator.vendor !== "Apple Computer, Inc." ||
        !navigator.userAgent.includes("Macintosh") ||
        navigator.maxTouchPoints > 0))
  )
    return context.destination;
  let output = outputs.get(context);
  if (!output) {
    const destination = context.createMediaStreamDestination();
    const media = new Audio();
    media.srcObject = destination.stream;
    output = { destination, media };
    outputs.set(context, output);
    observeAudioOutput(media);
  }
  return output.destination;
}

// Only the opt-in experiment couples native output controls to the transport.
export function experimentalPlaybackOutput() {
  return audioOutputMode() === "element" && context
    ? outputs.get(context)?.media
    : undefined;
}

export function playbackContext() {
  context ??= new AudioContext({
    latencyHint: "interactive",
    sampleRate: 48_000,
  });
  observeAudioContext(context);
  return context;
}

export function resumePlayback(context: AudioContext) {
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session) session.type = "playback";
  // Both starts must happen inside the same gesture, before any await.
  return Promise.all([
    context.state === "running"
      ? (logAudio("context.resume.skipped-running"), Promise.resolve())
      : observeAudioPromise("context.resume", () => context.resume()),
    outputs.has(context)
      ? observeAudioPromise("output.play", () =>
          outputs.get(context)!.media.play(),
        )
      : undefined,
  ]).then(() => {});
}

export const transitionSeconds = 0.005;

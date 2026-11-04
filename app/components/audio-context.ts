let context: AudioContext | undefined;
const outputs = new WeakMap<
  AudioContext,
  { destination: MediaStreamAudioDestinationNode; media: HTMLAudioElement }
>();

export function playbackDestination(context: AudioContext): AudioNode {
  // macOS Safari can queue about a second at the device destination even when
  // outputLatency reports milliseconds. Keep the gain/worklet graph, but let
  // a media element handle device output. Exclude iPads using desktop identity.
  if (
    navigator.vendor !== "Apple Computer, Inc." ||
    !navigator.userAgent.includes("Macintosh") ||
    navigator.maxTouchPoints > 0
  )
    return context.destination;
  let output = outputs.get(context);
  if (!output) {
    const destination = context.createMediaStreamDestination();
    const media = new Audio();
    media.srcObject = destination.stream;
    output = { destination, media };
    outputs.set(context, output);
  }
  return output.destination;
}

export function playbackContext() {
  context ??= new AudioContext({
    latencyHint: "interactive",
    sampleRate: 48_000,
  });
  return context;
}

export function resumePlayback(context: AudioContext) {
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session) session.type = "playback";
  // Both starts must happen inside the same gesture, before any await.
  return Promise.all([
    context.state === "running" ? Promise.resolve() : context.resume(),
    outputs.get(context)?.media.play(),
  ]).then(() => {});
}

export const transitionSeconds = 0.005;

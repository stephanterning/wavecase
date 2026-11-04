let context: AudioContext | undefined;

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
  return context.state === "running" ? Promise.resolve() : context.resume();
}

export const transitionSeconds = 0.005;

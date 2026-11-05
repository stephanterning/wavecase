let context: AudioContext | undefined;

export function playbackContext() {
  context ??= new AudioContext({
    latencyHint: "interactive",
    sampleRate: 48_000,
  });
  return context;
}

export function resumePlayback(context: AudioContext, nativeMedia = false) {
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  // A native file already supplies its own seekable media session. Forcing
  // playback also makes its normalization context eligible for Now Playing.
  // Reset auto explicitly when arriving from another page using Web Audio.
  if (session) session.type = nativeMedia ? "auto" : "playback";
  return context.state === "running" ? Promise.resolve() : context.resume();
}

export const transitionSeconds = 0.005;

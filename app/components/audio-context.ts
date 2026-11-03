let context: AudioContext | undefined;

export function playbackContext() {
  context ??= new AudioContext({ latencyHint: "interactive" });
  return context;
}

export function resumePlayback(context: AudioContext) {
  const session = (navigator as Navigator & { audioSession?: { type: string } })
    .audioSession;
  if (session) session.type = "playback";
  return context.state === "running" ? Promise.resolve() : context.resume();
}

export const transitionSeconds = 0.005;
// Two six-minute stereo/48 kHz buffers fit, without retaining a version cache.
export const maxBufferBytes = 192 * 1024 * 1024;

// decodeAudioData cannot be aborted. Serialize preparation so rapidly changing
// selections cannot leave several large decodes running at once.
let preparation = Promise.resolve();
export function loadPlaybackBuffer(
  context: AudioContext,
  url: string,
  signal: AbortSignal,
) {
  const result = preparation.then(async () => {
    signal.throwIfAborted();
    const response = await fetch(url, { signal, cache: "no-cache" });
    if (!response.ok) throw new Error("Audio could not be loaded.");
    const bytes = await response.arrayBuffer();
    signal.throwIfAborted();
    const buffer = await context.decodeAudioData(bytes);
    signal.throwIfAborted();
    if (buffer.length * buffer.numberOfChannels * 4 > maxBufferBytes)
      throw new Error("Audio exceeds the playback memory budget.");
    return buffer;
  });
  preparation = result.then(
    () => {},
    () => {},
  );
  return result;
}

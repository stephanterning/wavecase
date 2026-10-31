// One context per page keeps it unlocked across version changes. Sources belong
// to media elements and must be reused if an effect reconnects the same element.
let context: AudioContext | undefined;
const sources = new WeakMap<
  HTMLAudioElement,
  { source: MediaElementAudioSourceNode; gain: GainNode; connected: boolean }
>();

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

export async function playNormalized(media: HTMLAudioElement, gainDb: number) {
  // Let supporting browsers treat Web Audio as music, including in background.
  const audioSession = (
    navigator as Navigator & { audioSession?: { type: string } }
  ).audioSession;
  if (audioSession) audioSession.type = "playback";
  context ??= new AudioContext();
  let graph = sources.get(media);
  if (!graph) {
    graph = {
      source: context.createMediaElementSource(media),
      gain: context.createGain(),
      connected: false,
    };
    sources.set(media, graph);
  }
  graph.gain.gain.setValueAtTime(10 ** (gainDb / 20), context.currentTime);
  if (!graph.connected) {
    graph.source.connect(graph.gain);
    graph.gain.connect(context.destination);
    graph.connected = true;
  }
  try {
    // Start both synchronously in the user gesture, including on mobile Safari.
    await Promise.all([
      context.state === "running" ? Promise.resolve() : context.resume(),
      media.play(),
    ]);
  } catch (error) {
    media.pause();
    throw error;
  }
}

export function disconnectPlaybackAudio(media: HTMLAudioElement) {
  const graph = sources.get(media);
  if (!graph) return;
  graph.source.disconnect();
  graph.gain.disconnect();
  graph.connected = false;
}

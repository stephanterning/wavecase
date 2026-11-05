let context: AudioContext | undefined;

type Output = {
  destination: MediaStreamAudioDestinationNode;
  media: HTMLAudioElement;
  playing: Set<Transport>;
  idle?: ReturnType<typeof setTimeout>;
};
type Transport = EventTarget & {
  paused: boolean;
  ended: boolean;
  error: unknown;
};
const outputs = new WeakMap<AudioContext, Output>();
const followed = new WeakSet<Transport>();
// Longer than the 5 ms fade tail plus output buffering, so pausing the
// element never cuts audible samples.
const idleDelayMs = 100;

/** Apple WebKit plays the normalized gain/worklet graph through one media
 * element fed by a MediaStream instead of the device destination:
 *
 * - macOS Safari can queue about a second at the device destination even when
 *   outputLatency reports milliseconds; the media element output does not.
 * - Lock-screen and Control Center controls follow the media element. WebKit
 *   accepts a MediaStream-backed element as Now Playing once Media Session
 *   metadata or handlers exist, and drops an AudioContext whose destination is
 *   unconnected. A direct AudioContext would report playing whenever it runs
 *   and refresh its timeline only on a timer; the element reports its own
 *   paused state and Media Session position changes immediately.
 *
 * Pass the transport that feeds the graph so the element can follow it.
 */
export function playbackDestination(
  context: AudioContext,
  transport?: Transport,
): AudioNode {
  if (navigator.vendor !== "Apple Computer, Inc.") return context.destination;
  let output = outputs.get(context);
  if (!output) {
    const destination = context.createMediaStreamDestination();
    const media = new Audio();
    media.srcObject = destination.stream;
    output = { destination, media, playing: new Set() };
    outputs.set(context, output);
  }
  if (transport && !followed.has(transport)) {
    followed.add(transport);
    followOutput(output, transport);
  }
  return output.destination;
}

/** Keep the output element playing only while some transport plays, so Now
 * Playing shows Play and freezes once the player pauses, ends or fails. A
 * version switch hands over before its predecessor pauses, so the element keeps
 * playing. The idle pause relies on a page timer; while the page is hidden it
 * may run late, which delays only the paused state on the lock screen.
 * resumePlayback restarts the element inside the next play gesture.
 */
function followOutput(output: Output, transport: Transport) {
  const update = () => {
    if (transport.paused || transport.ended || transport.error)
      output.playing.delete(transport);
    else output.playing.add(transport);
    clearTimeout(output.idle);
    output.idle = undefined;
    if (!output.playing.size)
      output.idle = setTimeout(() => output.media.pause(), idleDelayMs);
  };
  for (const name of ["play", "pause", "ended", "error", "emptied"])
    transport.addEventListener(name, update);
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
  const output = outputs.get(context);
  if (output) {
    clearTimeout(output.idle);
    output.idle = undefined;
  }
  // Both starts must happen inside the same gesture, before any await.
  return Promise.all([
    context.state === "running" ? Promise.resolve() : context.resume(),
    output?.media.play(),
  ]).then(() => {});
}

export const transitionSeconds = 0.005;

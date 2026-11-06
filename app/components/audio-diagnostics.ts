// Opt-in, memory-only diagnostics. Never record URLs, titles, tokens or audio.
let enabled: boolean | undefined;
let sequence = 0;
const entries: object[] = [];
let context: AudioContext | undefined;

export function audioDiagnosticsEnabled() {
  if (typeof window === "undefined" || !window.location) return false;
  return (enabled ??=
    new URLSearchParams(window.location.search).get("audioDebug") === "1");
}

export function logAudio(event: string, details: Record<string, unknown> = {}) {
  if (!audioDiagnosticsEnabled()) return;
  try {
    const audioSession = (
      navigator as Navigator & {
        audioSession?: { type: string; state: string };
      }
    ).audioSession;
    entries.push({
      time: new Date().toISOString(),
      elapsedMs: Math.round(performance.now()),
      event,
      visibility: document.visibilityState,
      playbackState: navigator.mediaSession?.playbackState,
      contextState: context?.state,
      contextTime: context?.currentTime,
      audioSessionType: audioSession?.type,
      audioSessionState: audioSession?.state,
      userActivation: navigator.userActivation?.isActive,
      ...details,
    });
    if (entries.length > 500) entries.shift();
  } catch {
    // Diagnostics must never interrupt playback on a partially supported API.
  }
}

export function observeAudioPromise(
  event: string,
  start: () => Promise<void>,
): Promise<void> {
  if (!audioDiagnosticsEnabled()) return start();
  const attempt = ++sequence;
  logAudio(`${event}:requested`, { attempt });
  let result: Promise<void>;
  try {
    result = start(); // Preserve the user gesture: no await before starting.
  } catch (error) {
    logAudio(`${event}:threw`, {
      attempt,
      error: error instanceof Error ? error.name : "UnknownError",
    });
    throw error;
  }
  void result.then(
    () => logAudio(`${event}:resolved`, { attempt }),
    (error: unknown) =>
      logAudio(`${event}:rejected`, {
        attempt,
        error: error instanceof Error ? error.name : "UnknownError",
      }),
  );
  return result;
}

export function observeAudioContext(value: AudioContext) {
  if (!audioDiagnosticsEnabled() || context === value) return;
  context = value;
  logAudio("context.created");
  value.addEventListener("statechange", () => logAudio("context.statechange"));
}

export function attachAudioDiagnostics() {
  if (!audioDiagnosticsEnabled()) return () => {};
  const record = (event: Event) =>
    logAudio(`page.${event.type}`, {
      ...(event instanceof PageTransitionEvent
        ? { persisted: event.persisted }
        : {}),
    });
  document.addEventListener("visibilitychange", record);
  const events = ["pageshow", "pagehide", "focus", "blur"] as const;
  for (const event of events) window.addEventListener(event, record);
  logAudio("diagnostics.started");
  return () => {
    document.removeEventListener("visibilitychange", record);
    for (const event of events) window.removeEventListener(event, record);
  };
}

export function audioDiagnosticsReport() {
  logAudio("diagnostics.snapshot");
  return JSON.stringify({ format: "wavecase-audio-v1", entries }, null, 2);
}

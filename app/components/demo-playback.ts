import {
  switchPlayback,
  createPlaybackMedia,
  setPlaybackSource,
  type PlaybackMedia,
  destroyPlaybackMedia,
  observePlaybackLoop,
  playMedia,
  seekPlayback,
  startPlaybackAt,
} from "./playback-audio";

export type DemoSource = {
  trackId?: string;
  versionName?: string;
  key: string;
  versionId: string;
  url: string;
  duration: number;
  peaks: number[];
  title: string;
  artist: string;
  artwork?: string;
  share?: string;
};

type State = {
  source: DemoSource | null;
  media: PlaybackMedia | null;
  loading: boolean;
  error: string;
  starting: boolean;
  playing: boolean;
  repeating: boolean;
};

function openMedia(url: string) {
  const media = createPlaybackMedia();
  setPlaybackSource(media, url);
  return media;
}

// HLS seeks are not sample-accurate and take longer than a frame, so a version
// change accepts a small offset instead of chasing the advancing old version.
const alignmentSeconds = 0.25;
const alignmentAttempts = 3;

function ready(
  media: PlaybackMedia,
  predicate: () => boolean,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const events = ["loadedmetadata", "canplay", "seeked", "playing", "error"];
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Audio loading timed out."));
    }, 30000);
    const cleanup = () => {
      clearTimeout(timeout);
      for (const event of events) media.removeEventListener(event, check);
      signal.removeEventListener("abort", check);
    };
    const check = (event?: Event) => {
      if (signal.aborted || media.error || event?.type === "error") {
        cleanup();
        reject(signal.reason || new Error("Audio could not be loaded."));
      } else if (predicate()) {
        cleanup();
        resolve();
      }
    };
    for (const event of events) media.addEventListener(event, check);
    signal.addEventListener("abort", check);
    check();
  });
}

/** Owns audio independently of the waveform. Retains the audible version and
 * either its paused predecessor or requested replacement for A/B comparison.
 */
export class DemoPlayback {
  private state: State = {
    source: null,
    media: null,
    loading: false,
    error: "",
    starting: false,
    playing: false,
    repeating: false,
  };
  private listeners = new Set<() => void>();
  private pending?: {
    media: PlaybackMedia;
    source: DemoSource;
    abort: AbortController;
    seekTo?: number;
  };
  private standby?: { media: PlaybackMedia; source: DemoSource };
  private stopLoop?: () => void;
  private wantPlay = false;
  private playAttempt = 0;

  constructor(
    private createMedia = openMedia,
    private playAudio = playMedia,
    private switchTo = switchPlayback,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<State>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private cancelPending() {
    const pending = this.pending;
    this.pending = undefined;
    pending?.abort.abort();
    if (pending) destroyPlaybackMedia(pending.media);
  }

  select = async (source: DemoSource) => {
    if (this.pending?.source.key === source.key) return;
    this.cancelPending();
    if (this.state.source?.key === source.key) {
      this.update({ source, loading: false, error: "" });
      return;
    }
    ++this.playAttempt;
    const cached =
      this.standby?.source.key === source.key ? this.standby.media : undefined;
    if (this.standby && !cached) destroyPlaybackMedia(this.standby.media);
    this.standby = undefined;
    const media = cached ?? this.createMedia(source.url);
    const pending = {
      media,
      source,
      abort: new AbortController(),
      seekTo: undefined as number | undefined,
    };
    this.pending = pending;
    media.preload = this.wantPlay ? "auto" : "metadata";
    media.loop = this.state.repeating;
    this.update({ loading: true, error: "" });
    const signal = pending.abort.signal;
    // Retry can run directly inside a user gesture on mobile Safari. Start
    // the silent candidate now, before metadata/network awaits lose it.
    const earlyPlay = this.wantPlay
      ? this.playAudio(media, true).then(
          () => null,
          (error: unknown) => error,
        )
      : null;
    const previous = this.state.media;
    const previousSource = this.state.source;
    const position = () => {
      const time = pending.seekTo ?? previous?.currentTime ?? 0;
      const duration = Number.isFinite(media.duration)
        ? media.duration
        : source.duration;
      return time < duration ? time : 0;
    };
    try {
      if (this.wantPlay) {
        await ready(media, () => media.readyState >= 1, signal);
        media.currentTime = position();
        try {
          if (earlyPlay) {
            const error = await earlyPlay;
            if (error) throw error;
          } else await this.playAudio(media, true);
        } catch (error) {
          if (this.wantPlay) throw error;
        }
        // Loading can take seconds. Align against the advancing old version,
        // not the position captured when the user selected the new version.
        for (let attempt = 0; this.wantPlay; attempt++) {
          await ready(
            media,
            () => media.readyState >= 3 && !media.seeking,
            signal,
          );
          if (
            !previous ||
            attempt === alignmentAttempts ||
            Math.abs(media.currentTime - position()) <= alignmentSeconds
          )
            break;
          media.currentTime = position();
        }
      }
      signal.throwIfAborted();
      if (!this.wantPlay) {
        media.pause();
        startPlaybackAt(media, position());
      }
      this.stopLoop?.();
      const stopLoop = observePlaybackLoop(media);
      const ended = () => {
        this.wantPlay = false;
      };
      media.addEventListener("ended", ended);
      const sync = (event: Event) =>
        this.update({
          playing: !media.paused,
          ...(media.error || event.type === "error"
            ? { error: "Audio is unavailable. Please try again." }
            : {}),
        });
      const events = ["play", "pause", "ended", "error"];
      for (const event of events) media.addEventListener(event, sync);
      this.stopLoop = () => {
        stopLoop();
        media.removeEventListener("ended", ended);
        for (const event of events) media.removeEventListener(event, sync);
      };
      if (this.wantPlay) this.switchTo(previous, media);
      if (previous && previousSource) {
        previous.pause();
        this.standby = { media: previous, source: previousSource };
      }
      this.pending = undefined;
      this.update({
        media,
        source,
        loading: false,
        error: "",
        starting: false,
        playing: !media.paused,
      });
    } catch (error) {
      if (signal.aborted) return;
      this.cancelPending();
      this.update({
        loading: false,
        starting: false,
        error:
          error instanceof Error && error.name === "NotAllowedError"
            ? "Playback was blocked. Press Retry to load the selected version."
            : "The selected audio could not be loaded. Please try again.",
      });
    }
  };

  play = async () => {
    const attempt = ++this.playAttempt;
    this.wantPlay = true;
    this.update({ error: "" });
    const { media } = this.state;
    const target = media || this.pending?.media;
    if (target) {
      if (!media) this.update({ starting: true });
      try {
        await this.playAudio(target, !media);
      } catch (error) {
        if (attempt !== this.playAttempt) return;
        this.wantPlay = false;
        this.update({
          starting: false,
          error: "Audio could not play. Please try again.",
        });
        throw error;
      }
    }
  };
  pause = () => {
    ++this.playAttempt;
    this.wantPlay = false;
    this.update({ starting: false });
    this.state.media?.pause();
    this.pending?.media.pause();
  };
  seek = (versionId: string, position: number) => {
    if (this.pending?.source.versionId === versionId)
      this.pending.seekTo = position;
    else if (this.state.source?.versionId === versionId && this.state.media)
      seekPlayback(this.state.media, position);
  };
  setRepeat = (repeat: boolean) => {
    this.update({ repeating: repeat });
    if (this.state.media) this.state.media.loop = repeat;
    if (this.pending) this.pending.media.loop = repeat;
  };
  reconcile = (available: string[]) => {
    if (this.standby && !available.includes(this.standby.source.key)) {
      destroyPlaybackMedia(this.standby.media);
      this.standby = undefined;
    }
    if (this.pending && !available.includes(this.pending.source.key))
      this.cancelPending();
    if (this.state.source && !available.includes(this.state.source.key))
      this.dispose();
  };
  dispose = () => {
    ++this.playAttempt;
    this.wantPlay = false;
    this.cancelPending();
    if (this.standby) destroyPlaybackMedia(this.standby.media);
    this.standby = undefined;
    this.stopLoop?.();
    this.stopLoop = undefined;
    if (this.state.media) destroyPlaybackMedia(this.state.media);
    this.update({
      media: null,
      source: null,
      loading: false,
      error: "",
      starting: false,
      playing: false,
    });
  };
}

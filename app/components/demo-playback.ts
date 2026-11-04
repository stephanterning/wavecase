import { BufferedAudio } from "./buffered-audio";
import {
  crossfadePlayback,
  createPlaybackMedia,
  type PlaybackMedia,
  disconnectPlaybackAudio,
  observePlaybackLoop,
  playNormalized,
  seekPlayback,
  transitionSeconds,
} from "./playback-audio";

export type DemoSource = {
  trackId?: string;
  versionName?: string;
  key: string;
  versionId: string;
  url: string;
  duration: number;
  gainDb: number;
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

function ready(
  media: PlaybackMedia,
  predicate: () => boolean,
  signal: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const events = ["loadedmetadata", "canplay", "seeked", "playing", "error"];
    const cleanup = () => {
      for (const event of events) media.removeEventListener(event, check);
      signal.removeEventListener("abort", check);
    };
    const check = () => {
      if (signal.aborted || media.error) {
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
 * either its predecessor or requested replacement for quick A/B comparison.
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
  private retired = new Set<PlaybackMedia>();
  private standby?: { media: BufferedAudio; source: DemoSource };
  private stopLoop?: () => void;
  private wantPlay = false;
  private playAttempt = 0;

  constructor(
    private createMedia = createPlaybackMedia,
    private playAudio = playNormalized,
    private fade = crossfadePlayback,
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
  private release(media: PlaybackMedia) {
    media.pause();
    disconnectPlaybackAudio(media);
    media.removeAttribute("src");
    media.load();
    this.retired.delete(media);
  }
  private cancelPending() {
    const pending = this.pending;
    this.pending = undefined;
    pending?.abort.abort();
    if (pending) this.release(pending.media);
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
    if (this.standby && !cached) this.release(this.standby.media);
    this.standby = undefined;
    cached?.follow(null);
    const media = cached ?? this.createMedia(source.duration);
    const pending = {
      media,
      source,
      abort: new AbortController(),
      seekTo: undefined as number | undefined,
    };
    this.pending = pending;
    media.preload = this.wantPlay ? "auto" : "metadata";
    media.loop = this.state.repeating;
    if (!cached) {
      media.src = source.url;
      if (media instanceof BufferedAudio)
        media.currentTime = this.state.media?.currentTime ?? 0;
    }
    this.update({ loading: true, error: "" });
    const signal = pending.abort.signal;
    // Retry can run directly inside a user gesture on mobile Safari. Start
    // the silent candidate now, before metadata/network awaits lose it.
    const earlyPlay = this.wantPlay
      ? this.playAudio(media, source.gainDb, true).then(
          () => null,
          (error: unknown) => error,
        )
      : null;
    try {
      await ready(media, () => media.readyState >= 1, signal);
      const previous = this.state.media;
      const position = () => {
        const time = pending.seekTo ?? previous?.currentTime ?? 0;
        return time < media.duration ? time : 0;
      };
      media.currentTime = position();
      if (this.wantPlay) {
        try {
          if (earlyPlay) {
            const error = await earlyPlay;
            if (error) throw error;
          } else await this.playAudio(media, source.gainDb, true);
        } catch (error) {
          if (this.wantPlay) throw error;
        }
        // Loading can take seconds. Align against the advancing old version,
        // not the position captured when the user selected the new version.
        do {
          await ready(
            media,
            () => media.readyState >= 3 && !media.seeking,
            signal,
          );
          if (!previous || Math.abs(media.currentTime - position()) <= 0.05)
            break;
          media.currentTime = position();
        } while (this.wantPlay);
      }
      signal.throwIfAborted();
      if (!this.wantPlay) {
        media.pause();
        media.currentTime = position();
      }
      this.stopLoop?.();
      const stopLoop = observePlaybackLoop(media);
      const ended = () => {
        this.wantPlay = false;
      };
      media.addEventListener("ended", ended);
      const sync = () =>
        this.update({
          playing: !media.paused,
          ...(media.error
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
      if (this.wantPlay) {
        this.fade(previous, media);
      }
      if (
        previous instanceof BufferedAudio &&
        media instanceof BufferedAudio &&
        this.state.source
      ) {
        const standby = { media: previous, source: this.state.source };
        this.standby = standby;
        const keep = () => {
          if (this.standby !== standby) return;
          previous.pause();
          previous.follow(media);
        };
        if (this.wantPlay) setTimeout(keep, transitionSeconds * 1000 + 50);
        else keep();
      } else if (previous && this.wantPlay && !previous.paused) {
        this.retired.add(previous);
        setTimeout(
          () => {
            if (this.retired.has(previous)) this.release(previous);
            // The gain reaches zero on the audio clock after 5 ms. Retain the
            // silent source a little longer so timer jitter cannot cut the ramp.
          },
          transitionSeconds * 1000 + 50,
        );
      } else {
        if (previous) this.release(previous);
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
    const { media, source } = this.state;
    const target = media || this.pending?.media;
    const gain = source?.gainDb ?? this.pending?.source.gainDb;
    if (target && gain !== undefined) {
      if (!media) this.update({ starting: true });
      try {
        await this.playAudio(target, gain, !media);
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
    for (const media of this.retired) this.release(media);
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
      this.release(this.standby.media);
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
    if (this.standby) this.release(this.standby.media);
    this.standby = undefined;
    this.stopLoop?.();
    this.stopLoop = undefined;
    if (this.state.media) this.release(this.state.media);
    for (const media of this.retired) this.release(media);
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

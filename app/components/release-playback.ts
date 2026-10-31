import { disconnectPlaybackAudio, playNormalized } from "./playback-audio";

export type ReleaseQueue = {
  releaseId: string;
  url: string;
  title: string;
  artwork: MediaImage | null;
  countPlays: boolean;
  tracks: {
    id: string;
    title: string;
    artist: string;
    duration: number;
    gainDb: number;
  }[];
};
export type ReleasePlaybackState = {
  queue: ReleaseQueue | null;
  index: number;
  status: "idle" | "loading" | "playing" | "paused" | "ended" | "error";
  position: number;
  duration: number;
  error: string;
};

function recordPlay(releaseId: string, trackId: string) {
  void fetch(`/release-assets/${releaseId}/events`, {
    method: "POST",
    body: new URLSearchParams({
      kind: "play",
      track: trackId,
      eventId: crypto.randomUUID(),
    }),
    keepalive: true,
  }).catch(() => {});
}

// One controller belongs to one mounted public layout. Pages only select music
// or control this same media element; navigating never loads another source.
export class ReleasePlayback {
  private state: ReleasePlaybackState = {
    queue: null,
    index: 0,
    status: "idle",
    position: 0,
    duration: 0,
    error: "",
  };
  private listeners = new Set<() => void>();
  private media: HTMLAudioElement | null = null;
  private attempt = 0;
  private counted = false;

  constructor(
    private playAudio = playNormalized,
    private onPlay = recordPlay,
  ) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<ReleasePlaybackState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }

  attach(media: HTMLAudioElement) {
    this.media = media;
    const listeners = {
      play: () => {
        if (!media.paused) this.update({ status: "loading", error: "" });
      },
      playing: () => {
        if (!this.state.queue || media.paused || media.ended) return;
        this.update({ status: "playing", error: "" });
        if (!this.counted) {
          this.counted = true;
          const { queue, index } = this.state;
          if (queue.countPlays)
            this.onPlay(queue.releaseId, queue.tracks[index].id);
        }
      },
      waiting: () => {
        if (!media.paused) this.update({ status: "loading" });
      },
      pause: () => {
        if (media.paused && !media.ended && this.state.status !== "error") {
          ++this.attempt;
          this.update({ status: "paused" });
        }
      },
      timeupdate: () => this.update({ position: media.currentTime }),
      durationchange: () => {
        if (Number.isFinite(media.duration))
          this.update({ duration: media.duration });
      },
      error: () => this.fail(),
      ended: () => {
        const { queue, index } = this.state;
        if (!queue) return;
        if (index + 1 < queue.tracks.length) void this.load(index + 1);
        else {
          this.counted = false;
          this.update({ status: "ended", position: media.currentTime });
        }
      },
    };
    for (const [event, listener] of Object.entries(listeners))
      media.addEventListener(event, listener);
    return () => {
      ++this.attempt;
      for (const [event, listener] of Object.entries(listeners))
        media.removeEventListener(event, listener);
      media.pause();
      disconnectPlaybackAudio(media);
      media.removeAttribute("src");
      media.load();
      this.media = null;
    };
  }

  start = (release: ReleaseQueue, trackId: string) => {
    const index = release.tracks.findIndex((track) => track.id === trackId);
    if (index < 0 || !this.media) return;
    const current = this.state.queue;
    if (
      current?.releaseId === release.releaseId &&
      current.tracks[this.state.index].id === trackId
    ) {
      this.toggle();
      return;
    }
    this.update({
      queue: { ...release, tracks: release.tracks.slice(index) },
      index: 0,
    });
    void this.load(0);
  };

  private load(index: number) {
    const { queue } = this.state;
    if (!queue || !this.media) return Promise.resolve();
    ++this.attempt;
    this.media.pause();
    const track = queue.tracks[index];
    this.counted = false;
    this.update({
      index,
      status: "loading",
      position: 0,
      duration: track.duration,
      error: "",
    });
    this.media.src = `/release-assets/${queue.releaseId}/audio?track=${track.id}`;
    return this.play();
  }

  play = async (): Promise<void> => {
    const { queue, index, status } = this.state;
    const media = this.media;
    if (!queue || !media) return;
    if (status === "ended") return this.load(0);
    if (media.error) media.load();
    const attempt = ++this.attempt;
    this.update({ status: "loading", error: "" });
    try {
      await this.playAudio(media, queue.tracks[index].gainDb);
    } catch (error) {
      if (attempt !== this.attempt) return;
      if (
        error instanceof DOMException &&
        error.name === "AbortError" &&
        media.paused
      )
        this.update({ status: "paused" });
      else this.fail("Playback could not start. Please try again.");
    }
  };

  toggle = () => {
    if (!this.media || !this.state.queue) return;
    if (
      this.media.paused ||
      this.state.status === "ended" ||
      this.state.status === "error"
    )
      void this.play();
    else {
      ++this.attempt;
      this.media.pause();
    }
  };

  seek = (position: number) => {
    if (!this.media || !Number.isFinite(position)) return;
    const next = Math.max(0, Math.min(position, this.state.duration));
    this.media.currentTime = next;
    this.update({
      position: next,
      ...(this.state.status === "ended" ? { status: "paused" as const } : {}),
    });
  };

  fail = (
    error = "Audio is unavailable. Try again or choose another track.",
  ) => {
    ++this.attempt;
    this.update({ status: "error", error });
    this.media?.pause();
  };

  reconcile = (releaseId: string, playableIds: string[]) => {
    const { queue } = this.state;
    if (queue?.releaseId !== releaseId) return;
    // A fresh page response can revoke access to buffered audio as well.
    if (queue.tracks.some((track) => !playableIds.includes(track.id))) {
      this.fail(
        "This release's audio availability has changed. Choose a track to continue.",
      );
      this.media?.removeAttribute("src");
      this.media?.load();
      this.update({ queue: null, index: 0, position: 0, duration: 0 });
    }
  };
}

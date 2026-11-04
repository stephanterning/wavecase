import { DemoPlayback, type DemoSource } from "./demo-playback";

/** The workspace owns only the controller explicitly selected for playback. */
export class WorkspacePlayback {
  private state: { playback: DemoPlayback | null; trackId: string | null } = {
    playback: null,
    trackId: null,
  };
  private listeners = new Set<() => void>();
  constructor(private create = () => new DemoPlayback()) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(playback: DemoPlayback | null, trackId: string | null) {
    this.state = { playback, trackId };
    for (const listener of this.listeners) listener();
  }
  forTrack(trackId: string) {
    return this.state.trackId === trackId && this.state.playback
      ? this.state.playback
      : this.create();
  }
  activate(playback: DemoPlayback, trackId: string) {
    if (this.state.playback === playback) return;
    this.state.playback?.dispose();
    this.update(playback, trackId);
  }
  release(playback: DemoPlayback) {
    if (this.state.playback !== playback) playback.dispose();
  }
  start(source: DemoSource & { trackId: string }) {
    const playback = this.forTrack(source.trackId);
    const current = playback.getSnapshot();
    if (
      (current.source?.key === source.key ||
        (!current.source && current.starting)) &&
      (current.playing || current.starting)
    ) {
      playback.pause();
      return;
    }
    this.activate(playback, source.trackId);
    // select synchronously creates its candidate; play keeps Safari's gesture.
    void playback.select(source);
    void playback.play().catch(() => {});
  }
  dispose = () => {
    this.state.playback?.dispose();
    this.update(null, null);
  };
}

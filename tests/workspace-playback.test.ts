import { test } from "node:test";
import assert from "node:assert/strict";
import { DemoPlayback, type DemoSource } from "../app/components/demo-playback";
import { WorkspacePlayback } from "../app/components/workspace-playback";
import type { PlaybackMedia } from "../app/components/playback-audio";

class Media extends EventTarget {
  private url = "";
  assignments = 0;
  preload = "";
  loop = false;
  paused = true;
  currentTime = 0;
  duration = 60;
  readyState = 0;
  seeking = false;
  error = null;
  set src(value: string) {
    this.url = value;
    this.assignments++;
    queueMicrotask(() => {
      this.readyState = 4;
      this.dispatchEvent(new Event("loadedmetadata"));
    });
  }
  get src() {
    return this.url;
  }
  async play() {
    this.paused = false;
    this.dispatchEvent(new Event("play"));
  }
  pause() {
    this.paused = true;
    this.dispatchEvent(new Event("pause"));
  }
  removeAttribute() {
    this.url = "";
  }
  load() {}
}
const source = (
  trackId: string,
  versionId = trackId,
): DemoSource & { trackId: string } => ({
  trackId,
  versionId,
  key: versionId,
  versionName: versionId,
  url: `/media/${versionId}`,
  duration: 60,
  gainDb: 0,
  peaks: [],
  title: trackId,
  artist: "Test",
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
function setup() {
  const media: Media[] = [];
  const workspace = new WorkspacePlayback(
    () =>
      new DemoPlayback(
        () => {
          const next = new Media();
          media.push(next);
          return next as unknown as PlaybackMedia;
        },
        async (audio) => audio.play(),
        () => {},
      ),
  );
  return { workspace, media };
}

test("navigation retains active audio, position and repeat while another demo remains passive", async () => {
  const { workspace, media } = setup();
  const first = workspace.forTrack("a");
  await first.select(source("a"));
  workspace.activate(first, "a");
  await first.play();
  first.setRepeat(true);
  media[0].currentTime = 12;
  workspace.release(first); // Detail page unmount.
  assert.equal(media[0].paused, false);
  const preview = workspace.forTrack("b");
  await preview.select(source("b"));
  assert.equal(workspace.getSnapshot().playback, first);
  assert.equal(media[0].paused, false);
  assert.equal(media[1].paused, true);
  workspace.release(preview);
  assert.equal(media[1].src, "");
  const returned = workspace.forTrack("a");
  await returned.select(source("a"));
  assert.equal(returned, first);
  assert.equal(media[0].assignments, 1);
  assert.equal(media[0].currentTime, 12);
  assert.equal(returned.getSnapshot().repeating, true);
  workspace.dispose();
  assert.equal(media[0].paused, true);
  assert.equal(media[0].src, "");
  assert.equal(workspace.getSnapshot().playback, null);
});

test("library play selects the supplied default version, toggles it and stops the previous track", async () => {
  const { workspace, media } = setup();
  workspace.start(source("a", "a-latest"));
  await tick();
  assert.equal(
    workspace.getSnapshot().playback?.getSnapshot().source?.versionId,
    "a-latest",
  );
  assert.equal(media[0].paused, false);
  workspace.start(source("a", "a-latest"));
  assert.equal(media[0].paused, true);
  workspace.start(source("a", "a-latest"));
  await tick();
  assert.equal(media[0].paused, false);
  assert.equal(media[0].assignments, 1);
  workspace.start(source("b", "b-latest"));
  await tick();
  assert.equal(media[0].paused, true);
  assert.equal(media[0].src, "");
  assert.equal(media[1].paused, false);
  assert.equal(media[1].currentTime, 0);
  workspace.getSnapshot().playback?.reconcile([]);
  assert.equal(media[1].paused, true);
  assert.equal(media[1].src, "");
  workspace.dispose();
});

test("a second library click cancels initial play and a rapid track change cannot revive old audio", async () => {
  const { workspace, media } = setup();
  workspace.start(source("a"));
  workspace.start(source("a"));
  await tick();
  assert.equal(media[0].paused, true);
  workspace.start(source("b"));
  workspace.start(source("c"));
  await tick();
  assert.equal(media[0].src, "");
  assert.equal(media[1].src, "");
  assert.equal(media[2].paused, false);
  assert.equal(workspace.getSnapshot().trackId, "c");
  workspace.dispose();
});

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  attachWaveformGestures,
  selectedTimes,
  type CommentSelection,
} from "../app/components/waveform-gestures";
class Surface extends EventTarget {
  style: Record<string, string> = {};
  hidden = false;
  getBoundingClientRect() {
    return { left: 0, width: 1000 };
  }
  setPointerCapture() {}
  focus() {}
  append() {}
  remove() {}
  setAttribute() {}
}
test("waveform gestures support both selection directions, zoomed coordinates, touch hold and pinch without accidental comments", (t) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => new Surface() },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, "document", old);
    else Reflect.deleteProperty(globalThis, "document");
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const surface = new Surface();
  let width = 1000,
    scroll = 0;
  const media = { currentTime: 0 };
  const selections: CommentSelection[] = [];
  const stop = attachWaveformGestures(
    surface as unknown as HTMLElement,
    {
      getWidth: () => 1000,
      getWrapper: () =>
        ({
          getBoundingClientRect: () => ({ left: -scroll, width }),
        }) as unknown as HTMLElement,
      getScroll: () => scroll,
      setScroll: (value) => {
        scroll = Math.max(0, Math.min(width - 1000, value));
      },
      zoom: (pixels) => {
        width = pixels * 100;
      },
    },
    media as HTMLAudioElement,
    100,
    (selection) => selections.push(selection),
  );
  t.after(stop);
  const pointer = (
    type: string,
    x: number,
    button = 2,
    id = 1,
    touch = false,
  ) =>
    surface.dispatchEvent(
      Object.assign(new Event(type, { cancelable: true }), {
        clientX: x,
        clientY: 20,
        button,
        pointerId: id,
        pointerType: touch ? "touch" : "mouse",
        ctrlKey: false,
      }),
    );
  pointer("pointerdown", 200);
  pointer("pointermove", 800);
  pointer("pointerup", 800);
  pointer("pointerdown", 800);
  pointer("pointermove", 200);
  pointer("pointerup", 200);
  assert.deepEqual(selections, [
    { start: 20, end: 80 },
    { start: 20, end: 80 },
  ]);
  pointer("pointerdown", 250);
  pointer("pointerup", 250);
  assert.deepEqual(selections.at(-1), { start: 25, end: null });
  surface.dispatchEvent(
    Object.assign(new Event("wheel", { cancelable: true }), {
      deltaX: 0,
      deltaY: -Math.log(2) / 0.003,
      deltaMode: 0,
      clientX: 500,
      ctrlKey: false,
    }),
  );
  assert.equal(width, 2000);
  assert.equal(scroll, 500);
  pointer("pointerdown", 250);
  pointer("pointerup", 250);
  assert.deepEqual(selections.at(-1), { start: 37.5, end: null });
  pointer("pointerdown", 800, 0, 1, true);
  t.mock.timers.tick(500);
  pointer("pointermove", 200, 0, 1, true);
  pointer("pointerup", 200, 0, 1, true);
  assert.deepEqual(selections.at(-1), { start: 35, end: 65 });
  const count = selections.length;
  pointer("pointerdown", 400, 0, 1, true);
  pointer("pointerdown", 600, 0, 2, true);
  t.mock.timers.tick(600);
  pointer("pointermove", 800, 0, 2, true);
  assert.equal(width, 4000);
  pointer("pointerup", 400, 0, 1, true);
  pointer("pointerup", 800, 0, 2, true);
  assert.equal(selections.length, count);
  // Each new pinch must work after both fingers were lifted, including zoom out.
  for (const targetWidth of [2000, 1000, 2000]) {
    const endX = 200 + (400 * targetWidth) / width;
    pointer("pointerdown", 200, 0, 1, true);
    pointer("pointerdown", 600, 0, 2, true);
    pointer("pointermove", endX, 0, 2, true);
    pointer("pointerup", endX, 0, 2, true);
    pointer("pointerup", 200, 0, 1, true);
    assert.equal(width, targetWidth);
    assert.equal(media.currentTime, 0);
    assert.equal(selections.length, count);
  }
  pointer("pointerdown", 200);
  pointer("pointercancel", 300);
  pointer("pointerup", 400);
  assert.equal(selections.length, count);
  pointer("pointerdown", 500, 0);
  pointer("pointerup", 500, 0);
  assert.ok(media.currentTime > 0);
  assert.equal(selections.length, count);
});
test("time selection never rounds past the supplied point and orders reverse ranges", () => {
  assert.deepEqual(selectedTimes(3.337, 1.119, true), {
    start: 1.11,
    end: 3.33,
  });
  assert.deepEqual(selectedTimes(0, 0, false), { start: 0, end: null });
});

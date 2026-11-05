import { test } from "node:test";
import assert from "node:assert/strict";
import { listenForSpace } from "../app/components/use-space-toggle";

class Element {
  isContentEditable = false;
  constructor(
    readonly tag: string,
    readonly attributes: Record<string, string> = {},
    readonly parent?: Element,
  ) {}
  matches(selector: string) {
    const [, tag, has, not] =
      /^(\w*)(?:\[(\w+='[^']+')\])?(?::not\(\[(\w+='[^']+')\]\))?$/.exec(
        selector,
      ) ?? [];
    const attribute = (pair?: string) => {
      const [name, value] = pair?.split("=") ?? [];
      return this.attributes[name] === value?.slice(1, -1);
    };
    return (
      (!tag || tag === this.tag) &&
      (!has || attribute(has)) &&
      (!not || !attribute(not))
    );
  }
  closest(selectors: string): Element | null {
    return selectors.split(", ").some((selector) => this.matches(selector))
      ? this
      : (this.parent?.closest(selectors) ?? null);
  }
}

function setup(t: { after: (fn: () => void) => void }, slider?: boolean) {
  let keydown: ((event: unknown) => void) | undefined;
  const globals = { HTMLElement: Element, window: {} };
  Object.assign(globals.window, {
    addEventListener: (_: string, listener: typeof keydown) => {
      keydown = listener;
    },
    removeEventListener: () => {
      keydown = undefined;
    },
  });
  const saved = Object.keys(globals).map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ]);
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { configurable: true, value });
  let ready = true;
  let toggles = 0;
  const stop = listenForSpace({
    ready: () => ready,
    toggle: () => toggles++,
    slider,
  });
  t.after(() => {
    stop();
    for (const [name, descriptor] of saved as [string, PropertyDescriptor][])
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
  });
  const press = (target: Element, init: Record<string, unknown> = {}) => {
    const before = toggles;
    let prevented = false;
    keydown?.({
      code: "Space",
      key: " ",
      target,
      preventDefault: () => (prevented = true),
      ...init,
    });
    return { toggled: toggles - before, prevented };
  };
  return { press, setReady: (value: boolean) => (ready = value) };
}

const toggles = { toggled: 1, prevented: true };
const native = { toggled: 0, prevented: false };
const body = new Element("body");

for (const slider of [false, true])
  test(`Space toggles once per press outside fields and dialogs, even on focused buttons (${slider ? "public" : "workspace"})`, (t) => {
    const { press } = setup(t, slider);
    assert.deepEqual(press(body), toggles);
    assert.deepEqual(press(new Element("button", {}, body)), toggles);
    assert.deepEqual(press(new Element("div", { role: "slider" })), toggles);
    assert.deepEqual(press(body, { repeat: true }), {
      toggled: 0,
      prevented: true,
    });
  });

test("Space keeps native behavior in fields, dialogs, composition and shortcuts", (t) => {
  const { press, setReady } = setup(t);
  const editable = new Element("div");
  editable.isContentEditable = true;
  for (const target of [
    new Element("input", { type: "search" }),
    new Element("input", { type: "checkbox" }),
    new Element("input", { type: "range" }),
    new Element("textarea"),
    new Element("select"),
    editable,
    new Element("button", {}, new Element("dialog")),
    new Element("button", {}, new Element("div", { role: "dialog" })),
    new Element("button", {}, new Element("div", { role: "alertdialog" })),
    new Element("div", { role: "textbox" }),
  ])
    assert.deepEqual(press(target), native, target.tag);
  for (const init of [
    { shiftKey: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
    { defaultPrevented: true },
    { code: "Enter", key: "Enter" },
  ])
    assert.deepEqual(press(body, init), native, JSON.stringify(init));
  setReady(false);
  assert.deepEqual(press(body), native);
});

test("the public player also toggles from its focused position slider", (t) => {
  const { press } = setup(t, true);
  assert.deepEqual(press(new Element("input", { type: "range" })), toggles);
  assert.deepEqual(press(new Element("input", { type: "text" })), native);
  assert.deepEqual(
    press(new Element("input", { type: "range" }, new Element("dialog"))),
    native,
  );
});

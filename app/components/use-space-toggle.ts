import { useEffect, useEffectEvent } from "react";

const native =
  "textarea, select, dialog, [role='dialog'], [role='alertdialog'], [role='textbox']";

export type SpaceToggle = {
  /** Whether the player has music; otherwise Space keeps its native behavior. */
  ready: () => boolean;
  toggle: () => void;
  /** Also toggle while a range input, the position slider, has focus. */
  slider?: boolean;
};

/**
 * Space toggles playback, including while other buttons have focus. Editable
 * fields, form inputs, selects, dialogs, composition and modified presses keep
 * their native behavior. Holding the key toggles once without scrolling.
 */
export function useSpaceToggle({ ready, toggle, slider = false }: SpaceToggle) {
  const isReady = useEffectEvent(ready);
  const onToggle = useEffectEvent(toggle);
  useEffect(
    () =>
      listenForSpace({
        ready: () => isReady(),
        toggle: () => onToggle(),
        slider,
      }),
    [slider],
  );
}

export function listenForSpace({ ready, toggle, slider = false }: SpaceToggle) {
  const keydown = (event: KeyboardEvent) => {
    if (
      (event.code !== "Space" && event.key !== " ") ||
      event.defaultPrevented ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey
    )
      return;
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          `${slider ? "input:not([type='range'])" : "input"}, ${native}`,
        ))
    )
      return;
    if (!ready()) return;
    event.preventDefault();
    if (!event.repeat) toggle();
  };
  window.addEventListener("keydown", keydown, true);
  return () => window.removeEventListener("keydown", keydown, true);
}

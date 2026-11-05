import { useSyncExternalStore } from "react";

const key = "wavecase.repeat";
const listeners = new Set<() => void>();
let repeat: boolean | undefined;

export function repeatPreference() {
  if (repeat === undefined)
    try {
      repeat = sessionStorage.getItem(key) === "on";
    } catch {
      repeat = false;
    }
  return repeat;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One repeat choice for demo and release players for the tab's session. */
export function useRepeatPreference() {
  return useSyncExternalStore(subscribe, repeatPreference, () => false);
}

export function setRepeatPreference(value: boolean) {
  repeat = value;
  try {
    sessionStorage.setItem(key, value ? "on" : "off");
  } catch {
    // Without storage the choice still lasts until the page is reloaded.
  }
  for (const listener of listeners) listener();
}

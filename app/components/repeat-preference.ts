import { createLocalPreference, useLocalPreference } from "./local-preference";

const preference = createLocalPreference(
  "wavecase.repeat",
  false,
  (stored) => stored === "on",
  (value) => (value ? "on" : "off"),
);

export const repeatPreference = preference.getSnapshot;

/** One browser-local repeat choice for demo and release players across sessions. */
export function useRepeatPreference() {
  return useLocalPreference(preference);
}

export const setRepeatPreference = preference.set;

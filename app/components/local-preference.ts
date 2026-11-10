import { useSyncExternalStore } from "react";

// UI preferences only: never store private links, searches or form contents.
export function createLocalPreference<T>(
  key: string,
  defaultValue: T,
  parse: (stored: string) => T,
  serialize: (value: T) => string = JSON.stringify,
) {
  const listeners = new Set<() => void>();
  let stored: string | null | undefined;
  let value = defaultValue;
  let unsaved = false;
  return {
    getServerSnapshot: () => defaultValue,
    getSnapshot: () => {
      if (!unsaved)
        try {
          const next = localStorage.getItem(key);
          if (next !== stored) {
            stored = next;
            value = defaultValue;
            if (next !== null) value = parse(next);
          }
        } catch {
          // Invalid data uses the default; blocked storage keeps the page's choice.
        }
      return value;
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      const changed = (event: StorageEvent) => {
        if (event.key !== key && event.key !== null) return;
        if (unsaved) stored = undefined;
        unsaved = false;
        listener();
      };
      window.addEventListener("storage", changed);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", changed);
      };
    },
    set: (next: T) => {
      value = next;
      unsaved = true;
      try {
        const encoded = serialize(next);
        localStorage.setItem(key, encoded);
        stored = encoded;
        unsaved = false;
      } catch {
        // Full or blocked storage must not prevent changing the controls.
      }
      for (const listener of listeners) listener();
    },
  };
}

export function useLocalPreference<T>(
  preference: ReturnType<typeof createLocalPreference<T>>,
) {
  return useSyncExternalStore(
    preference.subscribe,
    preference.getSnapshot,
    preference.getServerSnapshot,
  );
}

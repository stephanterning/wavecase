import { librarySorts, type LibrarySort } from "../domain/library";
import { createLocalPreference } from "./local-preference";

type LibrarySorting = { sort: LibrarySort; ascending: boolean };
const defaultSorting: LibrarySorting = { sort: "updatedAt", ascending: false };

export const librarySortPreference = createLocalPreference<LibrarySorting>(
  "wavecase.library.sort",
  defaultSorting,
  (stored) => {
    const value = JSON.parse(stored);
    return value &&
      librarySorts.includes(value.sort) &&
      typeof value.ascending === "boolean"
      ? { sort: value.sort, ascending: value.ascending }
      : defaultSorting;
  },
);

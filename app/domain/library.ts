export const librarySorts = [
  "favorite",
  "title",
  "artist",
  "versionCount",
  "updatedAt",
  "createdAt",
] as const;
export type LibrarySort = (typeof librarySorts)[number];

type TrackSortFields = {
  id: string;
  title: string;
  artist: string;
  favorite: boolean;
  versionCount: number;
  updatedAt: Date | string | null;
  createdAt: Date | string;
};

const timestamp = (value: Date | string) => new Date(value).getTime();

function compareUpdated(a: TrackSortFields, b: TrackSortFields) {
  if (a.updatedAt === null) return b.updatedAt === null ? 0 : 1;
  if (b.updatedAt === null) return -1;
  return timestamp(b.updatedAt) - timestamp(a.updatedAt);
}

export function compareLibraryTracks(
  a: TrackSortFields,
  b: TrackSortFields,
  sort: LibrarySort = "updatedAt",
  ascending = false,
) {
  let order: number;
  if (sort === "updatedAt") {
    // Unknown upload dates stay last in either direction.
    if (a.updatedAt === null || b.updatedAt === null)
      order = compareUpdated(a, b);
    else order = compareUpdated(a, b) * (ascending ? -1 : 1);
  } else {
    order =
      sort === "createdAt"
        ? timestamp(a.createdAt) - timestamp(b.createdAt)
        : sort === "favorite" || sort === "versionCount"
          ? Number(a[sort]) - Number(b[sort])
          : a[sort].localeCompare(b[sort], undefined, {
              sensitivity: "base",
              numeric: true,
            });
    if (!ascending) order = -order;
  }
  return (
    order ||
    compareUpdated(a, b) ||
    timestamp(b.createdAt) - timestamp(a.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

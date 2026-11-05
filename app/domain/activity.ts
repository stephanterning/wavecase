import { coverage } from "./listening";
export type Activity = {
  id: string;
  kind: string;
  browser: string;
  name: string | null;
  versionId: string | null;
  position: number | null;
  end: number | null;
  createdAt: Date | string;
};
export function summarizeActivity(events: Activity[]) {
  const times = events.map((e) => new Date(e.createdAt).getTime());
  return {
    visits: events.filter((e) => e.kind === "visit").length,
    plays: events.filter((e) => e.kind === "play").length,
    downloads: events.filter((e) => e.kind === "download-started").length,
    browsers: new Set(events.map((e) => e.browser)).size,
    listening: events
      .filter((e) => e.kind === "interval")
      .reduce(
        (sum, e) => sum + Math.max(0, (e.end || 0) - (e.position || 0)),
        0,
      ),
    first: times.length ? new Date(Math.min(...times)).toISOString() : null,
    latest: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}
export function playedIntervals(events: Activity[]) {
  return events
    .filter((e) => e.kind === "interval")
    .map((e) => ({ start: e.position || 0, end: e.end || 0 }));
}
export function uniqueCoverage(events: Activity[]) {
  return coverage(playedIntervals(events));
}

// Join adjacent heartbeat intervals, retaining pauses, seeks, repeats and version changes.
export function activityTimeline<T extends Activity>(events: T[]): T[] {
  const result: T[] = [];
  for (const event of events.toSorted(
    (a, b) => +new Date(a.createdAt) - +new Date(b.createdAt),
  )) {
    const previous = result.at(-1);
    if (
      event.kind === "interval" &&
      previous?.kind === "interval" &&
      event.versionId === previous.versionId &&
      event.position === previous.end
    ) {
      previous.end = event.end;
    } else result.push({ ...event });
  }
  return result;
}

export type ActivityRow = {
  event: Activity & { linkId: string; session: string };
};
function groupBy<T, K>(items: T[], key: (item: T) => K) {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}
const listenerName = (rows: ActivityRow[]) =>
  rows.find((r) => r.event.name)?.event.name || null;

// Unknown link or browser filters fall back to all, and a browser filter only
// applies to browsers seen through the selected link. Groups keep row order.
export function activityReport<R extends ActivityRow>(
  rows: R[],
  linkIds: string[],
  filter: { link: string; browser: string },
) {
  const link = linkIds.includes(filter.link) ? filter.link : "";
  const linkRows = link ? rows.filter((r) => r.event.linkId === link) : rows;
  const listeners = [...groupBy(linkRows, (r) => r.event.browser)].map(
    ([id, rows]) => ({ id, name: listenerName(rows), rows }),
  );
  const browser = listeners.some((l) => l.id === filter.browser)
    ? filter.browser
    : "";
  const selected = browser
    ? linkRows.filter((r) => r.event.browser === browser)
    : linkRows;
  const sessions = groupBy(selected, (r) =>
    JSON.stringify([r.event.linkId, r.event.browser, r.event.session]),
  );
  return {
    link,
    browser,
    listeners,
    rows: selected,
    byLink: groupBy(selected, (r) => r.event.linkId),
    byVersion: groupBy(selected, (r) => r.event.versionId),
    sessions: [...sessions].map(([key, rows]) => ({
      key,
      browser: rows[0].event.browser,
      name: listenerName(rows),
      rows,
      timeline: activityTimeline(rows.map((r): R["event"] => r.event)),
    })),
    downloads: selected.filter((r) => r.event.kind === "download-started"),
  };
}

// Position and width in percent of the version duration, with a minimum width
// so markers and sub-second events stay visible.
export function timelineBar(event: Activity, duration: number) {
  const start = event.position || 0,
    end = event.end ?? start;
  const left = Math.min(100, (Math.min(start, end) / duration) * 100);
  const width = Math.max(
    0.5,
    Math.min(100 - left, (Math.abs(end - start) / duration) * 100),
  );
  const kind =
    event.kind === "interval"
      ? "played"
      : event.kind === "seek"
        ? end >= start
          ? "skipped"
          : "backward"
        : "marker";
  return { left, width, kind };
}

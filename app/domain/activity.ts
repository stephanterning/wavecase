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

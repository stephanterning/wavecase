export type Interval = { start: number; end: number };
export function coverage(intervals: Interval[]) {
  const sorted = intervals
    .filter((i) => i.end > i.start)
    .toSorted((a, b) => a.start - b.start);
  let total = 0,
    end = 0;
  for (const i of sorted) {
    total += Math.max(0, i.end - Math.max(end, i.start));
    end = Math.max(end, i.end);
  }
  return total;
}
export function heatmap(intervals: Interval[], duration: number, count = 60) {
  const width = duration / count;
  if (width <= 0) return [];
  return Array.from(
    { length: count },
    (_, index) =>
      intervals.reduce(
        (sum, i) =>
          sum +
          Math.max(
            0,
            Math.min(i.end, (index + 1) * width) -
              Math.max(i.start, index * width),
          ),
        0,
      ) / width,
  );
}

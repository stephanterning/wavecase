import { streamRate } from "./audio-stream";

// The start of each window must land on an integer sample in both timelines.
export function flacWindow(rate: number, samples: number, index: number) {
  const start = index * 2 * rate;
  const count = Math.min(2 * rate, samples - start);
  let gcd = rate,
    divisor = streamRate;
  while (divisor) [gcd, divisor] = [divisor, gcd % divisor];
  const grid = rate / gcd;
  const overlap = rate === streamRate ? 0 : Math.ceil(rate / 25 / grid) * grid;
  const before = Math.min(overlap, start);
  const after = Math.min(overlap, samples - start - count);
  return {
    start: start - before,
    count: before + count + after,
    prefix: (before * streamRate) / rate,
  };
}

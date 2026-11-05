export function playbackGainDb(metadata: Record<string, unknown> | null) {
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const lufs = metadata?.lufs;
  const peak = metadata?.peak;
  const truePeak = metadata?.truePeak;
  const target = finite(lufs) ? -16 - lufs : 0;
  // Do not boost without both peak measurements. Silence/below-gate audio
  // has no integrated LUFS target. loudnorm rounds true peak to 0.01 dB.
  return Math.min(
    target,
    finite(peak) ? -peak : 0,
    finite(truePeak) ? -truePeak - 0.01 : 0,
  );
}

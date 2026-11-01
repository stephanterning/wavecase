export type FormatDetails = {
  bytes: number;
  bitDepths: number[];
  sampleRates: number[];
};
export type DownloadDetails = {
  wav: FormatDetails | null;
  mp3: FormatDetails;
};

export function formatDownloadDetails(details: FormatDetails) {
  const range = (values: number[], divisor = 1) => {
    const min = Math.min(...values) / divisor;
    const max = Math.max(...values) / divisor;
    return min === max ? String(min) : `${min}–${max}`;
  };
  return [
    `~${Number((details.bytes / 1_000_000).toFixed(1)) || "<0.1"} MB ZIP`,
    ...(details.bitDepths.length ? [`${range(details.bitDepths)}-bit`] : []),
    ...(details.sampleRates.length
      ? [`${range(details.sampleRates, 1000)} kHz`]
      : []),
  ].join(" · ");
}

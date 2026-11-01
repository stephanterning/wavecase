export const downloadFormats = ["wav", "flac", "mp3", "original"] as const;
export type DownloadFormat = (typeof downloadFormats)[number];

export type FormatDetails = {
  bytes: number | null;
  bitDepths: number[];
  sampleRates: number[];
};
export type DownloadDetails = {
  wav: FormatDetails | null;
  flac: FormatDetails | null;
  mp3: FormatDetails;
  original: FormatDetails;
  originalPreserved: boolean;
};

export function formatDownloadDetails(details: FormatDetails) {
  const range = (values: number[], divisor = 1) => {
    const min = Math.min(...values) / divisor;
    const max = Math.max(...values) / divisor;
    return min === max ? String(min) : `${min}–${max}`;
  };
  return [
    details.bytes === null
      ? "Size available after preparation"
      : `~${Number((details.bytes / 1_000_000).toFixed(1)) || "<0.1"} MB ZIP`,
    ...(details.bitDepths.length ? [`${range(details.bitDepths)}-bit`] : []),
    ...(details.sampleRates.length
      ? [`${range(details.sampleRates, 1000)} kHz`]
      : []),
  ].join(" · ");
}

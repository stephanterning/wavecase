export const streamRate = 48_000;
export const streamChannels = 2;
export const streamChunkFrames = streamRate * 2;
export type StreamManifest = {
  mp3Rate?: number;
  mp3Samples?: number;
  revision: string;
  sampleRate: number;
  channels: number;
  frames: number;
  chunkFrames: number;
};
export function validStreamManifest(value: StreamManifest) {
  return (
    value &&
    /^[a-f0-9]{64}$/.test(value.revision) &&
    value.sampleRate === streamRate &&
    (value.channels === 1 || value.channels === 2) &&
    Number.isSafeInteger(value.frames) &&
    value.frames > 0 &&
    (value.mp3Rate === undefined ||
      ([32000, 44100, 48000].includes(value.mp3Rate) &&
        Number.isSafeInteger(value.mp3Samples) &&
        value.frames ===
          Math.ceil((value.mp3Samples! * streamRate) / value.mp3Rate))) &&
    value.chunkFrames === streamChunkFrames
  );
}

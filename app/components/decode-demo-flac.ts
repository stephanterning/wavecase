import { streamRate, type StreamManifest } from "../domain/audio-stream";
import { flacWindow } from "../domain/demo-flac";

export async function decodeDemoFlac(
  context: AudioContext,
  bytes: ArrayBuffer,
  manifest: StreamManifest,
  index: number,
) {
  const { prefix } = flacWindow(
    manifest.flacRate!,
    manifest.flacSamples!,
    index,
  );
  const frames = Math.min(
    manifest.chunkFrames,
    manifest.frames - index * manifest.chunkFrames,
  );
  const buffer = await context.decodeAudioData(bytes);
  if (
    buffer.sampleRate !== streamRate ||
    buffer.numberOfChannels !== manifest.channels ||
    buffer.length < prefix + frames
  )
    throw new Error("Incomplete FLAC part");
  const result = new Float32Array(frames * manifest.channels);
  for (let c = 0; c < manifest.channels; c++) {
    const channel = buffer.getChannelData(c);
    for (let i = 0; i < frames; i++)
      result[i * manifest.channels + c] = channel[prefix + i];
  }
  return result.buffer;
}

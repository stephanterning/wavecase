import { MPEGDecoder } from "mpg123-decoder";
import { streamRate, type StreamManifest } from "../domain/audio-stream";

export async function decodeReleasePart(
  bytes: ArrayBuffer,
  manifest: StreamManifest,
  index: number,
  offset: number,
) {
  const rate = manifest.mp3Rate!;
  const start = index * 2 * rate;
  const count = Math.min(rate * 2, manifest.mp3Samples! - start);
  const decoder = new MPEGDecoder({ enableGapless: false });
  await decoder.ready;
  try {
    const audio = decoder.decode(new Uint8Array(bytes));
    // mpg123 returns dual mono for a mono source. Keep its original level.
    const decoded = audio.channelData.slice(0, manifest.channels);
    if (
      audio.errors.length ||
      audio.sampleRate !== rate ||
      decoded.length !== manifest.channels ||
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset + count > audio.samplesDecoded
    )
      throw new Error("Incomplete MP3 part");
    const frames = Math.min(
      manifest.chunkFrames,
      manifest.frames - index * manifest.chunkFrames,
    );
    let channels = decoded.map((channel) =>
      channel.subarray(offset, offset + count),
    );
    if (rate !== streamRate) {
      // Forty milliseconds is an integral number of samples at every supported
      // rate. Resample with matching phase and real audio on both sides.
      const before = Math.min(start, rate / 25);
      const after = Math.min(manifest.mp3Samples! - start - count, rate / 25);
      if (offset < before || offset + count + after > audio.samplesDecoded)
        throw new Error("Incomplete MP3 overlap");
      const prefix = (before * streamRate) / rate;
      const offline = new OfflineAudioContext(
        manifest.channels,
        prefix + frames,
        streamRate,
      );
      const input = offline.createBuffer(
        manifest.channels,
        before + count + after,
        rate,
      );
      decoded.forEach((channel, i) =>
        input
          .getChannelData(i)
          .set(channel.subarray(offset - before, offset + count + after)),
      );
      const source = offline.createBufferSource();
      source.buffer = input;
      source.connect(offline.destination);
      source.start();
      const output = await offline.startRendering();
      channels = channels.map((_, i) =>
        output.getChannelData(i).subarray(prefix, prefix + frames),
      );
    }
    const result = new Float32Array(frames * manifest.channels);
    for (let i = 0; i < frames; i++)
      for (let c = 0; c < manifest.channels; c++)
        result[i * manifest.channels + c] = channels[c][i];
    return result.buffer;
  } finally {
    decoder.free();
  }
}

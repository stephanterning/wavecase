import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  DownloadDetails,
  FormatDetails,
} from "../domain/download-details";
import { probeDownload } from "./download";

/** Inspect only when the download dialog opens; never encode audio for an estimate. */
export async function downloadDetails(
  directory: string,
  originals: string[],
  cover: string | null,
): Promise<DownloadDetails> {
  if (!originals.length)
    throw new Response("Audio unavailable", { status: 404 });
  // Audio and artwork are stored uncompressed in the ZIP. Allow for info text,
  // filenames and ZIP headers without building a second package just to size it.
  const extra =
    (cover ? (await stat(join(directory, cover))).size : 0) +
    4096 * (originals.length + 1);
  const wav: FormatDetails = { bytes: extra, bitDepths: [], sampleRates: [] };
  const mp3: FormatDetails = { bytes: extra, bitDepths: [], sampleRates: [] };
  let wavAvailable = true;
  for (const original of originals) {
    const { probe, plan } = await probeDownload(directory, original);
    const audio = probe.streams[0];
    const duration = Number(probe.format.duration || audio.duration);
    const rate = Number(audio.sample_rate);
    const bits =
      Number(audio.bits_per_raw_sample) || Number(audio.bits_per_sample);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Invalid audio duration");
    const cachedSize = async (suffix: string) => {
      try {
        return (await stat(join(directory, original + suffix))).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    };
    mp3.bytes += (await cachedSize(".mp3")) || (duration * 320_000) / 8;
    mp3.sampleRates.push(rate >= 48000 ? 48000 : rate >= 44100 ? 44100 : 32000);
    if (!plan.wavDownload) {
      wavAvailable = false;
      continue;
    }
    const unchanged =
      probe.format.format_name === "wav" &&
      /^pcm_[suf]\d/.test(audio.codec_name);
    const outputBits = unchanged
      ? bits
      : plan.codec === "pcm_s24le"
        ? 24
        : plan.codec === "pcm_s16le"
          ? 16
          : 8;
    const outputRate = unchanged ? rate : plan.sampleRate;
    wav.bytes += unchanged
      ? (await stat(join(directory, original))).size
      : (await cachedSize(".export.wav")) ||
        ((duration * outputRate * outputBits) / 8) * Number(audio.channels) +
          44;
    wav.bitDepths.push(outputBits);
    wav.sampleRates.push(outputRate);
  }
  return { wav: wavAvailable ? wav : null, mp3 };
}

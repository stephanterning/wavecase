import { stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  DownloadDetails,
  FormatDetails,
} from "../domain/download-details";
import { probeDownload, losslessSuffix, unchangedWav } from "./audio-exports";

/** Inspect only when the download dialog opens; never encode audio for an estimate. */
export async function downloadDetails(
  directory: string,
  originals: string[],
  cover: string | null,
  originalPreserved = true,
  losslessAllowed = true,
): Promise<DownloadDetails> {
  if (!originals.length)
    throw new Response("Audio unavailable", { status: 404 });
  const extra =
    (cover ? (await stat(join(directory, cover))).size : 0) +
    4096 * (originals.length + 1);
  const details = (): FormatDetails => ({
    bytes: extra,
    bitDepths: [],
    sampleRates: [],
  });
  const wav = details(),
    flac = details(),
    mp3 = details(),
    original = details();
  let lossless = losslessAllowed;
  for (const key of originals) {
    const { probe, plan } = await probeDownload(directory, key);
    const audio = probe.streams[0];
    const duration = Number(probe.format.duration || audio.duration);
    const rate = Number(audio.sample_rate);
    const bits =
      Number(audio.bits_per_raw_sample) || Number(audio.bits_per_sample);
    if (!Number.isFinite(duration) || duration <= 0)
      throw new Error("Invalid audio duration");
    const cachedSize = async (suffix: string) => {
      try {
        return (await stat(join(directory, key + suffix))).size;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    };
    const sourceBytes = (await stat(join(directory, key))).size;
    original.bytes! += sourceBytes;
    original.sampleRates.push(rate);
    if (bits) original.bitDepths.push(bits);
    mp3.bytes! += (await cachedSize(".mp3")) || (duration * 320_000) / 8;
    mp3.sampleRates.push(rate >= 48000 ? 48000 : rate >= 44100 ? 44100 : 32000);
    if (!plan.wavDownload) {
      lossless = false;
      continue;
    }
    wav.bytes! += unchangedWav(probe)
      ? sourceBytes
      : (await cachedSize(losslessSuffix("wav"))) ||
        duration * 44100 * 2 * Number(audio.channels) + 44;
    const flacBytes = await cachedSize(losslessSuffix("flac"));
    // FLAC size depends strongly on the signal; do not invent a compression ratio.
    flac.bytes =
      flac.bytes === null || flacBytes === null ? null : flac.bytes + flacBytes;
    for (const format of [wav, flac]) {
      format.bitDepths.push(16);
      format.sampleRates.push(44100);
    }
  }
  return {
    wav: lossless ? wav : null,
    flac: lossless ? flac : null,
    mp3,
    original,
    originalPreserved,
  };
}

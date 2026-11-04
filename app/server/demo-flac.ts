import { execFile } from "node:child_process";
import { open, readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { flacWindow } from "../domain/demo-flac";

// Pack independently decodable FLAC files into one derivative. Its byte index
// is published last so unfinished conversions never replace playable audio.
export async function encodeFlacParts(
  source: string,
  packPath: string,
  partPath: string,
  rate: number,
  samples: number,
) {
  const ends: number[] = [];
  const pack = await open(packPath, "w");
  let size = 0;
  try {
    for (let index = 0; index * rate * 2 < samples; index++) {
      const window = flacWindow(rate, samples, index);
      // A few trailing zero samples at EOF let decoders that round a resampled
      // length down render the final requested frame. Playback trims them.
      const pad =
        rate !== 48000 && window.start + window.count === samples ? 16 : 0;
      await promisify(execFile)(
        "ffmpeg",
        [
          "-nostdin",
          "-v",
          "error",
          "-xerror",
          "-y",
          "-protocol_whitelist",
          "file,pipe",
          "-ss",
          (window.start / rate).toFixed(9),
          "-i",
          source,
          "-map",
          "0:a:0",
          "-vn",
          "-map_metadata",
          "-1",
          "-af",
          `atrim=end_sample=${window.count},apad=pad_len=${pad}`,
          "-c:a",
          "flac",
          "-compression_level",
          "5",
          "-metadata_header_padding",
          "0",
          "-f",
          "flac",
          partPath,
        ],
        { timeout: 120_000, maxBuffer: 1024 * 1024 },
      );
      const bytes = await readFile(partPath);
      // FLAC STREAMINFO records its sample count in the low 36 bits here.
      if (
        bytes.length < 42 ||
        bytes.toString("ascii", 0, 4) !== "fLaC" ||
        (bytes[21] & 15) * 2 ** 32 + bytes.readUInt32BE(22) !==
          window.count + pad
      )
        throw new Error("Incomplete prepared FLAC window");
      await pack.writeFile(bytes);
      size += bytes.length;
      ends.push(size);
    }
    return ends;
  } finally {
    await pack.close();
    await rm(partPath, { force: true });
  }
}

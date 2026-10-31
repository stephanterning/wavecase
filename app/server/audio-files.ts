import { unlink } from "node:fs/promises";
import { join } from "node:path";

// Derived names are tied to a unique upload key, never to the version ID.
export async function removeAudioFiles(
  directory: string,
  keys: (string | null)[],
) {
  const files = new Set(
    keys
      .filter((key): key is string => !!key)
      .flatMap((key) => [
        key,
        key + ".mp3",
        key + ".mp3.tmp",
        key + ".export.wav",
        key + ".export.wav.tmp",
      ]),
  );
  await Promise.all(
    [...files].map((key) => unlink(join(directory, key)).catch(() => {})),
  );
}

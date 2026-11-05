import { removeHls } from "./hls";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  derivedFiles,
  isExportTemporary,
  playbackWav,
  mp3,
} from "./storage-keys";

// Derived names are tied to a unique upload key, never to the version ID.
export async function removeAudioFiles(
  directory: string,
  keys: (string | null)[],
) {
  const roots = [...new Set(keys.filter((key): key is string => !!key))];
  if (!roots.length) return;
  const names = await readdir(directory).catch(() => []);
  const files = new Set(
    roots.flatMap((key) => [
      key,
      ...derivedFiles(key),
      ...names.filter((name) => isExportTemporary(key, name)),
    ]),
  );
  await Promise.all(
    [...files].map((key) => unlink(join(directory, key)).catch(() => {})),
  );
  for (const key of new Set(
    roots.flatMap((key) => [key, playbackWav(key), mp3(key)]),
  ))
    await removeHls(directory, key);
}

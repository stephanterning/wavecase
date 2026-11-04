import { randomUUID } from "node:crypto";

// Every file derived from an upload key is named here, and removal derives the
// same list. Existing installations store files under these exact names.

export const playbackWav = (key: string) => key + ".wav";
export const mp3 = (key: string) => key + ".mp3";
// A separate cache name prevents reuse of older full-resolution WAV exports.
export const lossless = (key: string, format: "wav" | "flac") =>
  `${key}.16-44100.${format}`;
export const exportTemporary = (output: string) =>
  `${output}.${randomUUID()}.tmp`;
export const decodedSource = (key: string) => key + ".source.pcm";
export const decodedPlayback = (key: string) => key + ".pcm";
export const streamBase = (key: string) => key + ".stream-v1";
export const streamFile = (key: string, kind: "json" | "pcm" | "flac") =>
  `${streamBase(key)}.${kind}`;
export const flacPart = (key: string) => streamBase(key) + ".part.tmp";
export const temporary = (file: string) => file + ".tmp";

const exports = (key: string) => [
  mp3(key),
  lossless(key, "wav"),
  lossless(key, "flac"),
];

export function derivedFiles(key: string) {
  return [
    playbackWav(key),
    ...exports(key),
    decodedSource(key),
    decodedPlayback(key),
    // Release MP3 playback had prepared PCM in older deployments.
    ...[key, playbackWav(key), mp3(key)].flatMap((base) => [
      ...(["json", "pcm", "flac"] as const).flatMap((kind) => [
        streamFile(base, kind),
        temporary(streamFile(base, kind)),
      ]),
      flacPart(base),
    ]),
    // Names written by older deployments.
    key + ".m4a",
    key + ".export.wav",
    ...[...exports(key), key + ".export.wav"].map(temporary),
  ];
}

const uuidTemporary =
  /^\.[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\.tmp$/;

// An interrupted export leaves a temporary file that only a listing can find.
export const isExportTemporary = (key: string, name: string) =>
  exports(key).some(
    (output) =>
      name.startsWith(output) && uuidTemporary.test(name.slice(output.length)),
  );

export function playbackPlan(
  codec: string,
  sampleRate: number,
  bitDepth: number,
  format: string,
) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error("Invalid sample rate");
  const containers = format.split(",");
  const lower =
    sampleRate <= 44100 &&
    bitDepth <= 16 &&
    (sampleRate < 44100 || bitDepth < 16);
  let mime: string | null = null;
  if (
    containers.includes("wav") &&
    ["pcm_u8", "pcm_s16le"].includes(codec) &&
    sampleRate <= 44100
  )
    mime = "audio/wav";
  else if (containers.includes("mp3") && codec === "mp3") mime = "audio/mpeg";
  else if (containers.includes("mov") && codec === "aac") mime = "audio/mp4";
  else if (containers.includes("aac") && codec === "aac") mime = "audio/aac";
  else if (containers.includes("ogg") && ["opus", "vorbis"].includes(codec))
    mime = "audio/ogg";
  else if (containers.includes("flac") && codec === "flac" && lower)
    mime = "audio/flac";
  // Unknown containers, including CAF and Matroska, receive a compatible WAV.
  // FFmpeg decoding a codec is not evidence of browser container support.
  return {
    keepOriginal: mime !== null,
    mime: mime || "audio/wav",
    sampleRate: mime ? sampleRate : Math.min(sampleRate, 44100),
    codec: bitDepth > 0 && bitDepth < 16 ? "pcm_u8" : "pcm_s16le",
  };
}

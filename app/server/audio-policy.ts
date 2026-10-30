export function playbackPlan(
  codec: string,
  sampleRate: number,
  bitDepth: number,
  format: string,
) {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0)
    throw new Error("Invalid sample rate");
  const containers = format.split(",");
  const lossless =
    /^pcm_[suf]\d/.test(codec) ||
    ["flac", "alac", "ape", "tta"].includes(codec);
  const bits = Math.min(bitDepth || 24, 24);
  const outputCodec =
    bits <= 8 ? "pcm_u8" : bits <= 16 ? "pcm_s16le" : "pcm_s24le";
  let mime: string | null = null;
  if (sampleRate <= 48000) {
    if (containers.includes("wav") && codec === outputCodec && bitDepth <= 24)
      mime = "audio/wav";
    else if (!lossless) {
      if (containers.includes("mp3") && codec === "mp3") mime = "audio/mpeg";
      else if (containers.includes("mov") && codec === "aac")
        mime = "audio/mp4";
      else if (containers.includes("aac") && codec === "aac")
        mime = "audio/aac";
      else if (containers.includes("ogg") && ["opus", "vorbis"].includes(codec))
        mime = "audio/ogg";
    }
  }
  return {
    keepOriginal: mime !== null,
    mime: mime || "audio/wav",
    sampleRate: Math.min(sampleRate, 48000),
    codec: outputCodec,
    wavDownload: lossless,
    dither: bitDepth > 24,
  };
}

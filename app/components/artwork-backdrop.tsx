import type { CSSProperties } from "react";

export function ArtworkBackdrop({ src }: { src?: string | null }) {
  if (!src) return null;
  return (
    <div
      className="release-backdrop"
      aria-hidden="true"
      style={
        { "--release-art": `url(${JSON.stringify(src)})` } as CSSProperties
      }
    />
  );
}

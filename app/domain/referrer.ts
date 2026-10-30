// Keep only the referring website, never paths, credentials, or private share tokens.
export function referrerWebsite(
  value: string | null | undefined,
  ownOrigin: string,
) {
  try {
    const url = new URL(value || "");
    return ["http:", "https:"].includes(url.protocol) &&
      url.origin !== ownOrigin
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

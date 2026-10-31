// Credits remain metadata, not separately managed person records.
export function songwriters(value: string = "") {
  const seen = new Set<string>();
  return value
    .split(/[,;\n\r]+/)
    .map((name) => name.trim().replace(/\s+/g, " "))
    .filter(Boolean)
    .map((name) => ({
      name,
      slug: name
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, "-")
        .replace(/^-|-$/g, ""),
    }))
    .filter(({ name, slug }) => {
      const key = slug || name;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export const songwriterPath = (slug: string) =>
  `/songwriter/${encodeURIComponent(slug)}`;

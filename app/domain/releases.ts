import { z } from "zod";
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters, numbers, and hyphens for the address.",
  );
export const slugify = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
    .replace(/-$/, "");
export const releaseFields = [
  "releaseDate",
  "label",
  "catalogNumber",
  "upc",
  "genre",
  "copyright",
  "phonographicCopyright",
  "credits",
] as const;
export const trackFields = [
  "artist",
  "guests",
  "version",
  "isrc",
  "songwriters",
  "producers",
  "credits",
] as const;
export type ReleaseMetadata = Partial<
  Record<(typeof releaseFields)[number], string>
>;
export type TrackMetadata = Partial<
  Record<(typeof trackFields)[number], string>
> & { explicit?: boolean };

// A single-track release can use its track credits in the page heading.
// Album track guests must not become release-wide artist credits.
export function releaseArtistSuffix(
  primaryArtist: string,
  tracks: { metadata: TrackMetadata }[],
) {
  if (tracks.length !== 1) return "";
  const { artist, guests } = tracks[0].metadata;
  const primary = primaryArtist.trim().toLowerCase();
  const seen = new Set([primary]);
  const additional = (
    artist?.trim().toLowerCase() === primary ? "" : artist || ""
  )
    .split(",")
    .map((name) => name.trim())
    .filter((name) => {
      const key = name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return (
    (additional.length ? `, ${additional.join(", ")}` : "") +
    (guests?.trim() ? ` featuring ${guests.trim()}` : "")
  );
}
export const externalLinksSchema = z
  .array(
    z.object({
      label: z.string().trim().min(1).max(100),
      url: z
        .url()
        .max(2000)
        .refine(
          (v) => ["https:", "http:"].includes(new URL(v).protocol),
          "Use an HTTP or HTTPS URL.",
        ),
    }),
  )
  .max(30);
export function parseLinks(value: string) {
  return externalLinksSchema.parse(
    value
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const split = line.indexOf("|");
        if (split < 1)
          throw new z.ZodError([
            {
              code: "custom",
              path: [],
              message: "Enter links as Label | https://example.com.",
            },
          ]);
        return {
          label: line.slice(0, split).trim(),
          url: line.slice(split + 1).trim(),
        };
      }),
  );
}
export const emailSchema = z.email().max(254);
export function releaseInfo(
  release: {
    title: string;
    kind: string;
    description: string;
    metadata: ReleaseMetadata;
  },
  artist: string,
  tracks: {
    title: string;
    position: number;
    metadata: TrackMetadata;
    sampleRate: number | null;
    bitDepth: number | null;
  }[],
  total: number,
) {
  const fields = (data: object) =>
    Object.entries(data)
      .filter(([, v]) => v !== "" && v != null)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
  return `${artist} — ${release.title}\nType: ${release.kind}\n${release.description}\n${fields(release.metadata)}\n\nIncluded tracks: ${tracks.length} of ${total}\n\n${tracks.map((t) => `${t.position}. ${t.title}\n${fields(t.metadata)}\nWAV: ${t.bitDepth} bit, ${t.sampleRate} Hz`).join("\n\n")}\n`;
}

export const releasePath = (
  artist: { slug: string },
  release: { slug: string },
) => `/artists/${artist.slug}/${release.slug}`;

const services = [
  { icon: "spotify", domains: ["spotify.com", "spotify.link"] },
  { icon: "deezer", domains: ["deezer.com", "deezer.page.link"] },
  { icon: "soundcloud", domains: ["soundcloud.com"] },
  {
    icon: "amazon-music",
    domains: [
      "music.amazon.com",
      "music.amazon.co.uk",
      "music.amazon.de",
      "music.amazon.fr",
      "music.amazon.it",
      "music.amazon.es",
      "music.amazon.co.jp",
      "music.amazon.ca",
      "music.amazon.com.au",
      "music.amazon.com.br",
      "music.amazon.com.mx",
      "music.amazon.in",
    ],
  },
  { icon: "qobuz", domains: ["qobuz.com"] },
  { icon: "youtube", domains: ["youtube.com", "youtu.be"] },
  { icon: "apple-music", domains: ["music.apple.com", "itunes.apple.com"] },
  { icon: "tidal", domains: ["tidal.com"] },
  { icon: "tiktok", domains: ["tiktok.com"] },
];

export function getReleaseServiceIcon(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return;
  const service = services.find(({ domains }) =>
    domains.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    ),
  );
  return service ? `/service-icons/${service.icon}.png` : undefined;
}

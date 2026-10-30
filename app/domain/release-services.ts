const amazonStorefronts = [
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.fr",
  "amazon.it",
  "amazon.es",
  "amazon.co.jp",
  "amazon.ca",
  "amazon.com.au",
  "amazon.com.br",
  "amazon.com.mx",
  "amazon.in",
];

const services = [
  { icon: "spotify", domains: ["spotify.com", "spotify.link"] },
  { icon: "deezer", domains: ["deezer.com", "deezer.page.link"] },
  { icon: "soundcloud", domains: ["soundcloud.com"] },
  {
    icon: "amazon-music",
    domains: amazonStorefronts.map((domain) => `music.${domain}`),
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
  // Amazon also shares player links on its storefronts; ordinary shop links are not music links.
  if (
    parsed.pathname.startsWith("/music/player/") &&
    amazonStorefronts.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname === `www.${domain}`,
    )
  ) {
    return "/service-icons/amazon-music.png";
  }
  const service = services.find(({ domains }) =>
    domains.some(
      (domain) =>
        parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`),
    ),
  );
  return service ? `/service-icons/${service.icon}.png` : undefined;
}

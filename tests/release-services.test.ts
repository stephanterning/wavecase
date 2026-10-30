import { test } from "node:test";
import assert from "node:assert/strict";
import { getReleaseServiceIcon } from "../app/domain/release-services";

test("release links identify all nine services from their destination", () => {
  const cases = [
    ["https://open.spotify.com/album/example", "spotify"],
    ["https://www.deezer.com/en/album/123", "deezer"],
    ["https://soundcloud.com/artist/track", "soundcloud"],
    ["https://music.amazon.com/albums/example", "amazon-music"],
    ["https://www.qobuz.com/gb-en/album/example", "qobuz"],
    ["https://www.youtube.com/watch?v=example", "youtube"],
    ["https://music.apple.com/us/album/example/123", "apple-music"],
    ["https://tidal.com/browse/album/123", "tidal"],
    ["https://www.tiktok.com/music/example-123", "tiktok"],
  ];
  for (const [url, service] of cases) {
    assert.equal(
      getReleaseServiceIcon(url),
      `/service-icons/${service}.png`,
      url,
    );
  }
});

test("shared links, regional stores, and HTTP links retain service icons", () => {
  const cases = [
    ["https://spotify.link/example", "spotify"],
    ["https://deezer.page.link/example", "deezer"],
    ["https://on.soundcloud.com/example", "soundcloud"],
    ["https://music.amazon.co.uk/albums/example", "amazon-music"],
    ["https://music.amazon.de/albums/example", "amazon-music"],
    ["https://music.amazon.co.jp/albums/example", "amazon-music"],
    ["https://music.amazon.com.au/albums/example", "amazon-music"],
    ["https://open.qobuz.com/album/example", "qobuz"],
    ["https://youtu.be/example", "youtube"],
    ["https://music.youtube.com/watch?v=example", "youtube"],
    ["https://itunes.apple.com/gb/album/example/123", "apple-music"],
    ["https://listen.tidal.com/album/123", "tidal"],
    ["https://vm.tiktok.com/example", "tiktok"],
    ["http://OPEN.SPOTIFY.COM/album/example?si=123#track", "spotify"],
  ];
  for (const [url, service] of cases) {
    assert.equal(
      getReleaseServiceIcon(url),
      `/service-icons/${service}.png`,
      url,
    );
  }
});

test("unknown destinations and service names outside the hostname have no icon", () => {
  for (const url of [
    "https://artist.bandcamp.com/album/example",
    "https://apple.com/",
    "https://www.amazon.com/music",
    "https://notspotify.com/album/example",
    "https://spotify.com.example.org/album/example",
    "https://music.amazon.com.example.org/albums/example",
    "https://music.amazon.example/albums/example",
    "https://notmusic.apple.com/album/example",
    "https://open.spotify.com@example.org/album/example",
    "https://example.org/spotify.com/album/example",
    "https://example.org/?url=https://open.spotify.com/album/example",
    "https://example.org/#youtube.com",
  ]) {
    assert.equal(getReleaseServiceIcon(url), undefined, url);
  }
});

test("invalid URLs and unsupported protocols have no icon", () => {
  for (const url of [
    "",
    "Spotify",
    "open.spotify.com/album/example",
    "/spotify.com/album/example",
    "https://",
    "ftp://open.spotify.com/album/example",
    "javascript:alert('spotify.com')",
    "mailto:artist@spotify.com",
  ]) {
    assert.equal(getReleaseServiceIcon(url), undefined, url);
  }
});

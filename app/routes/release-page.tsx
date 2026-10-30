import { releaseArtistSuffix, releasePath } from "../domain/releases";
import { getReleaseServiceIcon } from "../domain/release-services";
import { useMediaSession } from "../components/media-session";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { artists, releases } from "../server/schema";
import { publicRelease, releaseAccess } from "../server/releases";
import { origin } from "../server/security";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const [row] = await db
    .select({ id: releases.id })
    .from(releases)
    .innerJoin(artists, eq(releases.artistId, artists.id))
    .where(
      and(eq(artists.slug, params.artist!), eq(releases.slug, params.release!)),
    );
  if (!row) throw new Response("Release not found", { status: 404 });
  const d = await releaseAccess(request, row.id);
  const data = publicRelease(d);
  return {
    ...data,
    canonical: origin + releasePath(d.artist, d.release),
    image: d.release.cover
      ? `${origin}/release-assets/${d.release.id}/cover`
      : null,
  };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) => {
  if (!data) return [];
  const title = `${data.release.title} — ${data.artist.name}`;
  const description =
    data.release.description ||
    `Listen to ${data.release.title} by ${data.artist.name}. Streaming links, credits and master downloads.`;
  return [
    { title },
    // Native POST downloads need a same-origin Origin header; external links still receive no referrer.
    { name: "referrer", content: "same-origin" },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "music.album" },
    { property: "og:url", content: data.canonical },
    ...(data.image ? [{ property: "og:image", content: data.image }] : []),
    { name: "twitter:card", content: "summary_large_image" },
    { tagName: "link", rel: "canonical", href: data.canonical },
    ...(!data.release.published
      ? [{ name: "robots", content: "noindex, nofollow" }]
      : []),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "MusicAlbum",
        name: data.release.title,
        byArtist: { "@type": "MusicGroup", name: data.artist.name },
        image: data.image,
        url: data.canonical,
        datePublished: data.release.metadata.releaseDate,
        numTracks: data.tracks.length,
        track: data.tracks.map((t) => ({
          "@type": "MusicRecording",
          name: t.title,
          isrcCode: t.metadata.isrc,
        })),
      },
    },
  ];
};
const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
export default function ReleasePage() {
  const d = useLoaderData<typeof loader>();
  const available = d.tracks.filter((t) => t.available);
  const [selected, select] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [error, setError] = useState("");
  const audio = useRef<HTMLAudioElement>(null);
  const counted = useRef(false);
  const visited = useRef("");
  const selectedTrack = available.find((t) => t.id === selected);
  const endpoint = `/release-assets/${d.release.id}`;
  useMediaSession(
    audio,
    {
      title: selectedTrack?.title,
      artist: selectedTrack?.metadata.artist || d.artist.name,
      album: d.release.title,
      artwork: d.image,
    },
    () => setError("Playback could not start. Please try again."),
  );
  function event(kind: string, extra: Record<string, string> = {}) {
    if (d.owner || !d.release.published) return;
    void fetch(`${endpoint}/events`, {
      method: "POST",
      body: new URLSearchParams({
        kind,
        eventId: crypto.randomUUID(),
        ...extra,
      }),
      keepalive: true,
    }).catch(() => {});
  }
  useEffect(() => {
    if (visited.current === d.release.id || d.owner || !d.release.published)
      return;
    visited.current = d.release.id;
    void fetch(`/release-assets/${d.release.id}/events`, {
      method: "POST",
      body: new URLSearchParams({
        kind: "visit",
        eventId: crypto.randomUUID(),
      }),
      keepalive: true,
    }).catch(() => {});
  }, [d.release.id, d.release.published, d.owner]);
  function start(id: string) {
    if (!audio.current) return;
    setError("");
    if (selected === id) {
      if (audio.current.paused)
        void audio.current
          .play()
          .catch(() => setError("Playback could not start. Please try again."));
      else audio.current.pause();
    } else {
      select(id);
      counted.current = false;
      setPosition(0);
      audio.current.src = `${endpoint}/audio?track=${id}`;
      void audio.current
        .play()
        .catch(() => setError("Playback could not start. Please try again."));
    }
  }
  return (
    <article
      className="release-public"
      style={
        {
          "--release-art": d.image ? `url("${d.image}")` : "none",
        } as CSSProperties
      }
    >
      <div className="release-backdrop" aria-hidden="true" />
      {d.owner && (
        <p className="release-owner">
          <a href={`/releases/${d.release.id}`}>Edit release</a>
          {!d.release.published && " · Private draft preview"}
        </p>
      )}
      <div className="release-layout">
        <div>
          {d.image && (
            <img
              className="release-cover"
              src={d.image}
              alt={`${d.release.title} artwork`}
            />
          )}
        </div>
        <div className="release-content">
          <p className="eyebrow">
            {d.release.kind.toUpperCase()} · {d.release.metadata.releaseDate}
          </p>
          <h1>{d.release.title}</h1>
          <div className="release-artist">
            <a href={`/artists/${d.artist.slug}`}>{d.artist.name}</a>
            {releaseArtistSuffix(d.artist.name, d.tracks)}
          </div>
          <p className="preserve-lines">{d.release.description}</p>
          <audio
            ref={audio}
            preload="none"
            onPlaying={() => {
              setPlaying(true);
              setError("");
              if (!counted.current && selected) {
                counted.current = true;
                event("play", { track: selected });
              }
            }}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
            onError={() =>
              setError(
                "Audio is unavailable. Refresh the page or try again later.",
              )
            }
            onEnded={() => {
              setPlaying(false);
              counted.current = false;
              const next =
                available[available.findIndex((t) => t.id === selected) + 1];
              if (next) start(next.id);
            }}
          />
          <ol className="release-tracklist">
            {d.tracks.map((t) => (
              <li key={t.id}>
                <div className="release-track-row">
                  <span className="muted">{t.position}</span>
                  <div>
                    <strong>{t.title}</strong>
                    {t.metadata.guests && (
                      <small> featuring {t.metadata.guests}</small>
                    )}
                    {t.metadata.explicit && <small> · Explicit</small>}
                    <small>
                      {t.available
                        ? `${t.bitDepth}-bit / ${t.sampleRate! / 1000} kHz WAV`
                        : "Audio not available here"}
                    </small>
                  </div>
                  {t.available && (
                    <button
                      type="button"
                      aria-label={`${selected === t.id && playing ? "Pause" : "Play"} ${t.title}`}
                      onClick={() => start(t.id)}
                    >
                      {selected === t.id && playing ? "Pause" : "Play"}
                    </button>
                  )}
                </div>
                {selected === t.id && (
                  <label className="release-seek">
                    {time(position)} / {time(selectedTrack?.duration || 0)}
                    <input
                      aria-label="Playback position"
                      type="range"
                      min={0}
                      max={selectedTrack?.duration || 1}
                      step={0.1}
                      value={position}
                      onChange={(e) => {
                        if (audio.current)
                          audio.current.currentTime = Number(e.target.value);
                        setPosition(Number(e.target.value));
                      }}
                    />
                  </label>
                )}
              </li>
            ))}
          </ol>
          {error && <p role="alert">{error}</p>}
          {!!d.release.links.length && (
            <section>
              <h2>Stream or buy</h2>
              <div className="service-links">
                {d.release.links.map((l, i) => {
                  const icon = getReleaseServiceIcon(l.url);
                  return (
                    <a
                      key={i}
                      href={l.url}
                      onClick={() => event("click", { link: String(i) })}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span className="release-service-label">
                        {icon && (
                          <img src={icon} alt="" width={32} height={32} />
                        )}
                        <span>{l.label}</span>
                      </span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  );
                })}
              </div>
            </section>
          )}
          {!!available.length && d.release.published && (
            <details className="release-download">
              <summary>Download</summary>
              <p>
                {available.length} of {d.tracks.length} tracks included:{" "}
                {available.map((t) => t.title).join(", ")}.
              </p>
              <p className="muted">
                Every ZIP includes original WAV audio, artwork and
                release-info.txt with metadata and credits.
              </p>
              <form method="post" action={`${endpoint}/download`}>
                <label>
                  Package
                  <select name="track">
                    <option value="">
                      All available tracks ({available.length})
                    </option>
                    {available.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.position}. {t.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Email address
                  <input
                    type="email"
                    name="email"
                    required
                    maxLength={254}
                    autoComplete="email"
                  />
                </label>
                <p className="muted">
                  Your address is shared with the release owner and saved with
                  this download request.
                </p>
                <button>Download ZIP</button>
              </form>
            </details>
          )}
          <details className="release-credits">
            <summary>Metadata & credits</summary>
            <dl>
              {Object.entries(d.release.metadata)
                .filter(([, v]) => !!v)
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                    <dd className="preserve-lines">{value}</dd>
                  </div>
                ))}
            </dl>
            {d.tracks.map((t) => (
              <section key={t.id}>
                <h3>
                  {t.position}. {t.title}
                </h3>
                <dl>
                  {Object.entries(t.metadata)
                    .filter(([, v]) => !!v)
                    .map(([k, v]) => (
                      <div key={k}>
                        <dt>{k}</dt>
                        <dd className="preserve-lines">{String(v)}</dd>
                      </div>
                    ))}
                </dl>
              </section>
            ))}
          </details>
        </div>
      </div>
    </article>
  );
}

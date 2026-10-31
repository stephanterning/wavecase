import {
  DownloadDialog,
  DownloadEmail,
  DownloadFormats,
} from "../components/download-dialog";
import { releaseArtistSuffix, releasePath } from "../domain/releases";
import { getReleaseServiceIcon } from "../domain/release-services";
import { SongwriterCredits } from "../components/songwriter-credits";
import { useReleasePlayer } from "../components/release-player";
import { playbackGainDb } from "../components/playback-audio";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  Link,
  useLoaderData,
  useRevalidator,
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
    mediaArtwork: d.release.cover
      ? {
          src: `${origin}/release-assets/${d.release.id}/artwork.jpg?v=${encodeURIComponent(d.release.cover)}`,
          sizes: "512x512",
          type: "image/jpeg",
        }
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
  const [downloadOpen, setDownloadOpen] = useState(false);
  const available = d.tracks.filter((t) => t.available);
  const playable = available.filter((t) => t.audioMeasurements);
  const waitingForMeasurements = available.some((t) => !t.audioMeasurements);
  const revalidator = useRevalidator();
  useEffect(() => {
    if (!waitingForMeasurements) return;
    const timer = setInterval(() => void revalidator.revalidate(), 3000);
    return () => clearInterval(timer);
  }, [waitingForMeasurements, revalidator]);
  const { playback, queue, index, status, position, duration } =
    useReleasePlayer();
  const selected =
    queue?.releaseId === d.release.id ? queue.tracks[index].id : null;
  const playing = status === "playing" || status === "loading";
  const visited = useRef("");
  const endpoint = `/release-assets/${d.release.id}`;
  useEffect(() => {
    playback.reconcile(
      d.release.id,
      playable.map((track) => track.id),
    );
  }, [playback, d.release.id, playable]);
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
    playback.start(
      {
        releaseId: d.release.id,
        url: releasePath(d.artist, d.release),
        title: d.release.title,
        artwork: d.mediaArtwork,
        countPlays: !d.owner && d.release.published,
        tracks: playable.map((track) => ({
          id: track.id,
          title: track.title,
          artist: track.metadata.artist || d.artist.name,
          duration: track.duration || 0,
          gainDb: playbackGainDb(track.audioMeasurements),
        })),
      },
      id,
    );
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
          <Link to={`/releases/${d.release.id}`}>Edit release</Link>
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
            <Link to={`/artists/${d.artist.slug}`}>{d.artist.name}</Link>
            {releaseArtistSuffix(d.artist.name, d.tracks)}
          </div>
          <p className="preserve-lines">{d.release.description}</p>
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
                      disabled={!t.audioMeasurements}
                      aria-label={`${selected === t.id && playing ? "Pause" : "Play"} ${t.title}`}
                      onClick={() => start(t.id)}
                    >
                      {!t.audioMeasurements
                        ? "Preparing playback…"
                        : selected === t.id && playing
                          ? "Pause"
                          : "Play"}
                    </button>
                  )}
                </div>
                {selected === t.id && (
                  <label className="release-seek">
                    {time(position)} / {time(duration)}
                    <input
                      aria-label="Playback position"
                      type="range"
                      min={0}
                      max={duration || 1}
                      step={0.1}
                      value={position}
                      onChange={(e) => {
                        playback.seek(Number(e.target.value));
                      }}
                    />
                  </label>
                )}
              </li>
            ))}
          </ol>
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
            <section className="release-download">
              <button type="button" onClick={() => setDownloadOpen(true)}>
                Download
              </button>
              {downloadOpen && (
                <DownloadDialog
                  title={d.release.title}
                  action={`${endpoint}/download`}
                  onClose={() => setDownloadOpen(false)}
                >
                  <p>
                    {available.length} of {d.tracks.length} tracks included:{" "}
                    {available.map((t) => t.title).join(", ")}.
                  </p>
                  <p className="muted">
                    Every ZIP includes audio in the selected format, artwork and
                    release-info.txt with metadata and credits.
                  </p>
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
                  <DownloadFormats />
                  <DownloadEmail ownerLabel="release owner" />
                </DownloadDialog>
              )}
            </section>
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
                        <dd className="preserve-lines">
                          {k === "songwriters" ? (
                            <SongwriterCredits value={String(v)} />
                          ) : (
                            String(v)
                          )}
                        </dd>
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

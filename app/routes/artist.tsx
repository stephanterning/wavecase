import { releasePath } from "../domain/releases";
import {
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { and, eq } from "drizzle-orm";
import { db } from "../server/db";
import { artists, releases } from "../server/schema";

import { origin, viewer } from "../server/security";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const artist = await db.query.artists.findFirst({
    where: eq(artists.slug, params.artist!),
  });
  if (!artist) throw new Response("Artist not found", { status: 404 });
  const user = await viewer(request);
  const rows = await db
    .select()
    .from(releases)
    .where(and(eq(releases.artistId, artist.id), eq(releases.published, true)));
  rows.sort((a, b) =>
    (b.metadata.releaseDate || b.createdAt.toISOString()).localeCompare(
      a.metadata.releaseDate || a.createdAt.toISOString(),
    ),
  );
  return {
    artist: {
      id: artist.id,
      name: artist.name,
      slug: artist.slug,
      bio: artist.bio,
      image: !!artist.image,
      links: artist.links,
    },
    releases: rows,
    owner: user?.id === artist.ownerId,
    canonical: `${origin}/artists/${artist.slug}`,
  };
}
export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  data
    ? [
        { title: `${data.artist.name} · Releases` },
        {
          name: "description",
          content: data.artist.bio || `Music by ${data.artist.name}`,
        },
        { tagName: "link", rel: "canonical", href: data.canonical },
      ]
    : [];
export default function ArtistPage() {
  const d = useLoaderData<typeof loader>();
  return (
    <section className="artist-page">
      {d.owner && <a href="/releases">Manage artists & releases</a>}
      {d.artist.image && (
        <img
          className="artist-image"
          src={`/artist-images/${d.artist.id}`}
          alt={d.artist.name}
        />
      )}
      <p className="eyebrow">ARTIST</p>
      <h1>{d.artist.name}</h1>
      <p className="preserve-lines">{d.artist.bio}</p>
      <div className="service-links">
        {d.artist.links.map((l, i) => (
          <a key={i} href={l.url} target="_blank" rel="noopener noreferrer">
            {l.label} ↗
          </a>
        ))}
      </div>
      <h2>Releases</h2>
      <div className="grid">
        {d.releases.map((r) => (
          <a
            className="release-card"
            href={releasePath(d.artist, r)}
            key={r.id}
          >
            <img
              src={`/release-assets/${r.id}/cover`}
              alt={`${r.title} artwork`}
            />
            <h3>{r.title}</h3>
            <p>
              {r.kind.toUpperCase()} · {r.metadata.releaseDate}
            </p>
          </a>
        ))}
      </div>
      {!d.releases.length && <p>No published releases yet.</p>}
    </section>
  );
}

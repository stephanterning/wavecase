import { asc, eq, sql } from "drizzle-orm";
import {
  Link,
  useLoaderData,
  type LoaderFunctionArgs,
  type MetaFunction,
} from "react-router";
import { releasePath } from "../domain/releases";
import { songwriters, songwriterPath } from "../domain/songwriters";
import { db } from "../server/db";
import { artists, releases, releaseTracks } from "../server/schema";
import { origin } from "../server/security";

export async function loader({ params }: LoaderFunctionArgs) {
  const rows = await db
    .select({
      id: releases.id,
      title: releases.title,
      slug: releases.slug,
      kind: releases.kind,
      releaseDate: sql<string | null>`${releases.metadata}->>'releaseDate'`,
      createdAt: releases.createdAt,
      artist: { name: artists.name, slug: artists.slug },
      credits: sql<string | null>`${releaseTracks.metadata}->>'songwriters'`,
    })
    .from(releases)
    .innerJoin(artists, eq(releases.artistId, artists.id))
    .innerJoin(releaseTracks, eq(releaseTracks.releaseId, releases.id))
    .where(eq(releases.published, true))
    .orderBy(
      asc(releases.createdAt),
      asc(releases.id),
      asc(releaseTracks.position),
    );

  let name = "";
  const matches = new Map<string, Omit<(typeof rows)[number], "credits">>();
  for (const { credits, ...release } of rows) {
    const writer = songwriters(credits || "").find(
      (writer) => writer.slug && writer.slug === params.songwriter,
    );
    if (!writer) continue;
    name ||= writer.name;
    matches.set(release.id, release);
  }
  if (!name) throw new Response("Songwriter not found", { status: 404 });

  return {
    name,
    canonical: origin + songwriterPath(params.songwriter!),
    releases: [...matches.values()].sort((a, b) =>
      (b.releaseDate || b.createdAt.toISOString()).localeCompare(
        a.releaseDate || a.createdAt.toISOString(),
      ),
    ),
  };
}

export const meta: MetaFunction<typeof loader> = ({ loaderData: data }) =>
  data
    ? [
        { title: `${data.name} · Songwriter · Releases` },
        {
          name: "description",
          content: `Releases featuring songs written by ${data.name}.`,
        },
        { tagName: "link", rel: "canonical", href: data.canonical },
      ]
    : [];

export default function SongwriterPage() {
  const data = useLoaderData<typeof loader>();
  return (
    <section className="artist-page">
      <p className="eyebrow">SONGWRITER</p>
      <h1>{data.name}</h1>
      <h2>Releases</h2>
      <div className="grid">
        {data.releases.map((release) => (
          <Link
            className="release-card"
            to={releasePath(release.artist, release)}
            key={release.id}
          >
            <img
              src={`/release-assets/${release.id}/cover`}
              alt={`${release.title} artwork`}
            />
            <h3>
              {release.artist.name} - {release.title}
            </h3>
            <p>
              {release.kind.toUpperCase()}
              {release.releaseDate && ` · ${release.releaseDate}`}
            </p>
          </Link>
        ))}
      </div>
    </section>
  );
}

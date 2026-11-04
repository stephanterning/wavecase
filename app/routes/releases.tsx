import { artistScope } from "../server/ownership";
import { Link } from "react-router";
import { useState } from "react";
import { AddressField } from "../components/address-field";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { artists, releases } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import { formError, ownedArtist } from "../server/releases";
import { slugify, slugSchema } from "../domain/releases";
import { CreateDialog } from "../components/create-dialog";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    artists: await db
      .select()
      .from(artists)
      .where(artistScope(user.id))
      .orderBy(asc(artists.name)),
    releases: await db
      .select({ release: releases, artist: artists })
      .from(releases)
      .innerJoin(artists, eq(releases.artistId, artists.id))
      .where(artistScope(user.id))
      .orderBy(desc(releases.createdAt)),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  await requireUser(request);
  try {
    const f = await (await limitedBody(request, 11 * 1024 * 1024)).formData();
    const intent = f.get("intent");
    const name = z.string().trim().min(1).max(200).parse(f.get("name"));
    if (intent === "release") {
      const artist = await ownedArtist(request, String(f.get("artist")));
      const [release] = await db
        .insert(releases)
        .values({
          artistId: artist.id,
          title: name,
          slug: slugSchema.parse(f.get("slug") || slugify(name)),
          kind: z.enum(["single", "ep", "album"]).parse(f.get("kind")),
        })
        .returning();
      return redirect(`/releases/${release.id}`);
    } else throw new Response("Unknown action", { status: 400 });
  } catch (error) {
    return formError(error);
  }
}
export default function Releases() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [search, setSearch] = useSearchParams();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [artist, setArtist] = useState(() =>
    data.artists.some((a) => a.id === search.get("artist"))
      ? search.get("artist")!
      : data.artists[0]?.id || "",
  );
  const filter = search.get("q") || "";
  const artistFilter = search.get("artist") || "";
  const status = search.get("status") || "all";
  const updateFilter = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true, preventScrollReset: true });
  };
  const visible = data.releases.filter(
    ({ release, artist }) =>
      (!artistFilter || artist.id === artistFilter) &&
      (status === "all" ||
        (status === "published" ? release.published : !release.published)) &&
      `${release.title} ${artist.name}`
        .toLowerCase()
        .includes(filter.toLowerCase()),
  );
  return (
    <>
      <p className="eyebrow">YOUR RELEASES</p>
      <h1>Releases</h1>
      <CreateDialog title="Add release" error={result?.error}>
        <Form method="post" className="panel">
          <input type="hidden" name="intent" value="release" />

          <label>
            Artist
            <select
              name="artist"
              required
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
            >
              {data.artists.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Title
            <input
              name="name"
              required
              maxLength={200}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <AddressField
            name={name}
            prefix={`/artists/${data.artists.find((a) => a.id === artist)?.slug || "…"}`}
            value={slug}
            onChange={setSlug}
          />
          <label>
            Type
            <select name="kind">
              <option value="single">Single</option>
              <option value="ep">EP</option>
              <option value="album">Album</option>
            </select>
          </label>
          <button disabled={!data.artists.length}>Create draft</button>
          {!data.artists.length && (
            <p>
              <Link to="/artist-profiles?create=1">
                Create an artist profile first.
              </Link>
            </p>
          )}
        </Form>
      </CreateDialog>
      <div className="filter-toolbar">
        <label>
          Search releases
          <input
            type="search"
            value={filter}
            onChange={(event) => updateFilter("q", event.target.value)}
            placeholder="Title or artist"
          />
        </label>
        <label>
          Artist
          <select
            value={artistFilter}
            onChange={(event) => updateFilter("artist", event.target.value)}
          >
            <option value="">All artists</option>
            {data.artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            value={status}
            onChange={(event) => updateFilter("status", event.target.value)}
          >
            <option value="all">All</option>
            <option value="draft">Drafts</option>
            <option value="published">Published</option>
          </select>
        </label>
      </div>
      {!visible.length && <p>No releases match these filters.</p>}
      <div className="catalog-grid">
        {visible.map(({ release, artist }) => (
          <Link
            className="panel release-card"
            to={`/releases/${release.id}`}
            key={release.id}
          >
            {release.cover ? (
              <img
                className="management-artwork"
                src={`/release-assets/${release.id}/cover`}
                alt={`${release.title} artwork`}
                loading="lazy"
                width="400"
                height="400"
              />
            ) : (
              <div className="management-artwork artwork-placeholder">
                No artwork yet
              </div>
            )}
            <p className="eyebrow">
              {release.published ? "PUBLISHED" : "DRAFT"} · {release.kind}
            </p>
            <h2>{release.title}</h2>
            <p>{artist.name}</p>
          </Link>
        ))}
      </div>
    </>
  );
}

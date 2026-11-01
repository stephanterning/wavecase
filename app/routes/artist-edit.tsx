import { EditForm, PreviewLink } from "../components/editing";
import { LinkFields } from "../components/link-fields";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { artists, releases } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
import { limitedBody } from "../server/request";
import {
  directory,
  formError,
  ownedArtist,
  storeArtwork,
} from "../server/releases";
import { parseLinks } from "../domain/releases";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const artist = await ownedArtist(request, params.id!);
  return {
    artist,
    releases: await db
      .select()
      .from(releases)
      .where(eq(releases.artistId, artist.id))
      .orderBy(desc(releases.createdAt)),
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  await requireUser(request);
  try {
    const f = await (await limitedBody(request, 11 * 1024 * 1024)).formData();
    const intent = f.get("intent");
    const name = z.string().trim().min(1).max(200).parse(f.get("name"));
    if (intent === "edit-artist" || intent === "artist-links") {
      const previous = await ownedArtist(request, params.id!);
      const values = {
        ...(intent === "edit-artist"
          ? {
              name,
              ...(f.has("links")
                ? { links: parseLinks(String(f.get("links") || "")) }
                : {}),
              bio: z
                .string()
                .max(5000)
                .parse(f.get("bio") || ""),
            }
          : { links: parseLinks(String(f.get("links") || "")) }),
      };
      await db.update(artists).set(values).where(eq(artists.id, previous.id));
    } else if (intent === "artist-image") {
      const artist = await ownedArtist(request, params.id!);
      const file = f.get("image");
      if (!(file instanceof File))
        throw new Response("Choose an image", { status: 400 });
      const key = await storeArtwork(file);
      await db
        .update(artists)
        .set({ image: key })
        .where(eq(artists.id, artist.id));
      if (artist.image)
        await unlink(join(directory(), artist.image)).catch(() => {});
    } else throw new Response("Unknown action", { status: 400 });
    if (f.has("_inline")) return { saved: true, error: undefined };
    return redirect(`/artist-profiles/${params.id}`);
  } catch (error) {
    return formError(error);
  }
}
export default function ArtistEdit() {
  const { artist: a, releases: rows } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <div className="editor-toolbar">
        <a href="/artist-profiles">Artists</a>
        <PreviewLink href={`/artists/${a.slug}?preview=1`}>
          Preview artist page
        </PreviewLink>
      </div>
      <header className="music-editor-hero">
        <div className="artist-portrait">
          {a.image ? (
            <img src={`/artist-images/${a.id}`} alt={a.name} />
          ) : (
            <span>{a.name.slice(0, 1)}</span>
          )}
        </div>
        <div>
          <p className="eyebrow">ARTIST</p>
          <h1>{a.name}</h1>
          <p className="artist-biography">
            {a.bio || "Add a biography to introduce your music."}
          </p>
          <div className="editor-controls">
            <EditForm label="Artist profile" trigger="Edit profile">
              <input type="hidden" name="intent" value="edit-artist" />
              <input type="hidden" name="id" value={a.id} />
              <label>
                Artist name
                <input
                  name="name"
                  defaultValue={a.name}
                  required
                  maxLength={200}
                />
              </label>
              <label>
                Biography
                <textarea name="bio" defaultValue={a.bio} maxLength={5000} />
              </label>
              <p className="muted">
                Saved changes appear immediately on your public artist page.
              </p>
              <button>Save profile</button>
            </EditForm>
            <EditForm
              label="Artist image"
              trigger="Change image"
              encType="multipart/form-data"
            >
              <input type="hidden" name="intent" value="artist-image" />
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="name" value={a.name} />
              {a.image && (
                <img
                  className="artist-image"
                  src={`/artist-images/${a.id}`}
                  alt={`${a.name} profile`}
                />
              )}
              <label>
                Profile image
                <input
                  type="file"
                  name="image"
                  accept="image/png,image/jpeg,image/webp"
                  required
                />
              </label>
              <button>Save image</button>
            </EditForm>
          </div>
        </div>
      </header>
      {result?.error && <p role="alert">{result.error}</p>}
      <div className="artist-editor-columns">
        <section>
          <h2>Releases</h2>
          <a href={`/releases?create=1&artist=${a.id}`}>
            Add release for {a.name}
          </a>
          <div className="catalog-grid">
            {rows.map((release) => (
              <a
                className="catalog-item"
                href={`/releases/${release.id}`}
                key={release.id}
              >
                {release.cover ? (
                  <img
                    className="management-artwork"
                    src={`/release-assets/${release.id}/cover`}
                    alt=""
                  />
                ) : (
                  <div className="management-artwork artwork-placeholder">
                    Add artwork
                  </div>
                )}
                <strong>{release.title}</strong>
                <span>
                  {release.published ? "Published" : "Draft"} · {release.kind}
                </span>
              </a>
            ))}
          </div>
          {!rows.length && (
            <p>No releases yet. Create a draft to get started.</p>
          )}
        </section>
        <aside>
          <h2>Links</h2>
          {a.links.map((link) => (
            <p key={link.url}>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {link.label} ↗
              </a>
            </p>
          ))}
          <EditForm label="Artist links" trigger="Edit links">
            <input type="hidden" name="intent" value="artist-links" />
            <input type="hidden" name="name" value={a.name} />
            <LinkFields links={a.links} />
            <button>Save links</button>
          </EditForm>
        </aside>
      </div>
    </>
  );
}

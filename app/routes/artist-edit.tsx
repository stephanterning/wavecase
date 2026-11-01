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
    if (intent === "edit-artist") {
      const previous = await ownedArtist(request, params.id!);
      const values = {
        name,
        bio: z
          .string()
          .max(5000)
          .parse(f.get("bio") || ""),
        links: parseLinks(String(f.get("links") || "")),
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
      <h1>{a.name}</h1>
      <PreviewLink href={`/artists/${a.slug}?preview=1`}>
        View public page
      </PreviewLink>
      {result?.error && <p role="alert">{result.error}</p>}
      <section className="panel">
        <EditForm label="Artist details">
          <input type="hidden" name="intent" value="edit-artist" />
          <input type="hidden" name="id" value={a.id} />
          <label>
            Artist name
            <input name="name" defaultValue={a.name} required maxLength={200} />
          </label>
          <label>
            Biography
            <textarea name="bio" defaultValue={a.bio} maxLength={5000} />
          </label>
          <LinkFields links={a.links} />
          <button>Save artist</button>
        </EditForm>
        <EditForm label="Profile image" encType="multipart/form-data">
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
          <button>Upload image</button>
        </EditForm>
      </section>
      <section className="panel">
        <h2>Releases</h2>
        <a href={`/releases?create=1&artist=${a.id}`}>
          Add release for {a.name}
        </a>
        <ul className="overview-list">
          {rows.map((release) => (
            <li key={release.id}>
              <a href={`/releases/${release.id}`}>{release.title}</a>
              <span>
                {release.published ? "Published" : "Draft"} · {release.kind}
              </span>
            </li>
          ))}
        </ul>
        {!rows.length && <p>No releases yet. Create a draft to get started.</p>}
      </section>
    </>
  );
}

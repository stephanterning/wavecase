import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { releasePath } from "../domain/releases";
import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { eq } from "drizzle-orm";
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
import { parseLinks, slugify, slugSchema } from "../domain/releases";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    artists: await db
      .select()
      .from(artists)
      .where(eq(artists.ownerId, user.id)),
    releases: await db
      .select({ release: releases, artist: artists })
      .from(releases)
      .innerJoin(artists, eq(releases.artistId, artists.id))
      .where(eq(artists.ownerId, user.id)),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  try {
    const f = await (await limitedBody(request, 11 * 1024 * 1024)).formData();
    const intent = f.get("intent");
    const name = z.string().trim().min(1).max(200).parse(f.get("name"));
    if (intent === "artist" || intent === "edit-artist") {
      const previous =
        intent === "edit-artist"
          ? await ownedArtist(request, String(f.get("id")))
          : null;
      const values = {
        name,
        bio: z
          .string()
          .max(5000)
          .parse(f.get("bio") || ""),
        links: parseLinks(String(f.get("links") || "")),
      };
      if (previous)
        await db.update(artists).set(values).where(eq(artists.id, previous.id));
      else
        await db
          .insert(artists)
          .values({
            ...values,
            ownerId: user.id,
            slug: slugSchema.parse(f.get("slug") || slugify(name)),
          });
    } else if (intent === "release") {
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
    } else if (intent === "artist-image") {
      const artist = await ownedArtist(request, String(f.get("id")));
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
    return redirect("/releases");
  } catch (error) {
    return formError(error);
  }
}
export default function Releases() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <nav>
        <a href="/library">Work in progress</a> · <a href="/account">Account</a>
      </nav>
      <p className="eyebrow">YOUR RELEASES</p>
      <h1>Ready for the world.</h1>
      {result?.error && <p role="alert">{result.error}</p>}
      <div className="grid">
        {data.releases.map(({ release, artist }) => (
          <article className="panel" key={release.id}>
            <p className="eyebrow">
              {release.published ? "PUBLISHED" : "DRAFT"} · {release.kind}
            </p>
            <h2>
              <a href={`/releases/${release.id}`}>{release.title}</a>
            </h2>
            <p>{artist.name}</p>
            <a href={releasePath(artist, release)}>View page</a>
          </article>
        ))}
      </div>
      <Form method="post" className="panel">
        <input type="hidden" name="intent" value="release" />
        <h2>New release</h2>
        <label>
          Artist
          <select name="artist" required>
            {data.artists.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input name="name" required maxLength={200} />
        </label>
        <label>
          Address (optional; suggested from title)
          <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} />
        </label>
        <label>
          Type
          <select name="kind">
            <option value="single">Single</option>
            <option value="ep">EP</option>
            <option value="album">Album</option>
          </select>
        </label>
        <button disabled={!data.artists.length}>Create draft</button>
        {!data.artists.length && <p>Create an artist profile first.</p>}
      </Form>
      <h2>Artist profiles</h2>
      {data.artists.map((a) => (
        <section className="panel" key={a.id}>
          <a href={`/artists/${a.slug}`}>/artists/{a.slug}</a>
          <Form method="post">
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
            <label>
              Links (one per line: Label | https://...)
              <textarea
                name="links"
                defaultValue={a.links
                  .map((l) => `${l.label} | ${l.url}`)
                  .join("\n")}
              />
            </label>
            <button>Save artist</button>
          </Form>
          <Form method="post" encType="multipart/form-data">
            <input type="hidden" name="intent" value="artist-image" />
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="name" value={a.name} />
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
          </Form>
        </section>
      ))}
      <Form method="post" className="panel">
        <input type="hidden" name="intent" value="artist" />
        <h2>New artist profile</h2>
        <label>
          Artist name
          <input name="name" required maxLength={200} />
        </label>
        <label>
          Address (optional; suggested from name)
          <input name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} />
        </label>
        <button>Create artist</button>
        <p className="muted">Addresses stay stable when names change.</p>
      </Form>
    </>
  );
}

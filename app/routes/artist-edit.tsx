import { unlink } from "node:fs/promises";
import { join } from "node:path";
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
import { artists } from "../server/schema";
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
  return { artist: await ownedArtist(request, params.id!) };
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
    return redirect(`/artist-profiles/${params.id}`);
  } catch (error) {
    return formError(error);
  }
}
export default function ArtistEdit() {
  const { artist: a } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <h1>{a.name}</h1>
      <a href={`/artists/${a.slug}`}>View public page</a>
      {result?.error && <p role="alert">{result.error}</p>}
      <section className="panel">
        <Form method="post">
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
    </>
  );
}

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
import { formError, ownedArtist } from "../server/releases";
import { slugify, slugSchema } from "../domain/releases";
import { CreateDialog } from "../components/create-dialog";
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
  return (
    <>
      <p className="eyebrow">YOUR RELEASES</p>
      <h1>Ready for the world.</h1>
      <CreateDialog title="Add release" error={result?.error}>
        <Form method="post" className="panel">
          <input type="hidden" name="intent" value="release" />

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
            <input
              name="slug"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={100}
            />
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
          {!data.artists.length && (
            <p>
              <a href="/artist-profiles?create=1">
                Create an artist profile first.
              </a>
            </p>
          )}
        </Form>
      </CreateDialog>
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
    </>
  );
}

import {
  Form,
  redirect,
  useActionData,
  useLoaderData,
  type LoaderFunctionArgs,
  type ActionFunctionArgs,
} from "react-router";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import { artists, releases } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
import { formError } from "../server/releases";
import { limitedBody } from "../server/request";
import { slugify, slugSchema } from "../domain/releases";
import { CreateDialog } from "../components/create-dialog";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    artists: await db
      .select({
        id: artists.id,
        name: artists.name,
        image: sql<boolean>`${artists.image} is not null`,
        releases: sql<number>`count(${releases.id})::int`,
      })
      .from(artists)
      .leftJoin(releases, eq(releases.artistId, artists.id))
      .where(eq(artists.ownerId, user.id))
      .groupBy(artists.id)
      .orderBy(asc(artists.name), asc(artists.id)),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  try {
    const f = await (await limitedBody(request, 65536)).formData();
    const name = z.string().trim().min(1).max(200).parse(f.get("name"));
    const [artist] = await db
      .insert(artists)
      .values({
        ownerId: user.id,
        name,
        slug: slugSchema.parse(f.get("slug") || slugify(name)),
      })
      .returning({ id: artists.id });
    return redirect(`/artist-profiles/${artist.id}`);
  } catch (error) {
    return formError(error);
  }
}
export default function ArtistProfiles() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <p className="eyebrow">YOUR ARTISTS</p>
      <h1>Artist profiles.</h1>
      <CreateDialog title="Add artist" error={result?.error}>
        <Form method="post" className="panel">
          <label>
            Artist name
            <input name="name" required maxLength={200} />
          </label>
          <label>
            Address (optional; suggested from name)
            <input
              name="slug"
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
              maxLength={100}
            />
          </label>
          <button>Create artist</button>
        </Form>
      </CreateDialog>
      <div className="grid">
        {data.artists.map((a) => (
          <a
            className="panel release-card"
            href={`/artist-profiles/${a.id}`}
            key={a.id}
          >
            {a.image ? (
              <img
                className="management-artwork"
                src={`/artist-images/${a.id}`}
                alt={`${a.name} profile`}
                width="400"
                height="400"
                loading="lazy"
              />
            ) : (
              <div className="management-artwork artwork-placeholder">
                No profile image yet
              </div>
            )}
            <h2>{a.name}</h2>
            <p className="muted">
              {a.releases} {a.releases === 1 ? "release" : "releases"}
            </p>
          </a>
        ))}
      </div>
      {!data.artists.length && (
        <p>No artists yet. Add your first artist profile.</p>
      )}
    </>
  );
}

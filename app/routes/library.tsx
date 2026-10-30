import { TrackArtistField } from "../components/track-artist-field";
import { artistChoices, resolveTrackArtist } from "../server/track-artist";
import { uploadVersion } from "../server/upload";
import { limitedBody } from "../server/request";
import { versionStatuses } from "../domain/versions";
import { redirect } from "react-router";
import { Form, useLoaderData, useActionData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { and, asc, desc, eq, ilike } from "drizzle-orm";
import { db } from "../server/db";
import { tracks } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  const search = new URL(request.url).searchParams.get("q") || "";
  return {
    user,
    artists: await artistChoices(user.id),
    search,
    sort: new URL(request.url).searchParams.get("sort") || "newest",
    tracks: await db
      .select()
      .from(tracks)
      .where(
        and(
          eq(tracks.ownerId, user.id),
          ilike(tracks.title, "%" + search + "%"),
        ),
      )
      .orderBy(
        new URL(request.url).searchParams.get("sort") === "title"
          ? asc(tracks.title)
          : desc(tracks.createdAt),
      ),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const form = await (
    await limitedBody(
      request,
      Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024 + 65536,
    )
  ).formData();
  const title = String(form.get("title") || "").trim();
  if (!title || title.length > 200)
    return { error: "Enter a title of up to 200 characters." };
  let artist;
  try {
    artist = await resolveTrackArtist(user.id, form);
  } catch (error) {
    if (error instanceof Response && error.status === 400)
      return { error: await error.text() };
    throw error;
  }
  const [track] = await db
    .insert(tracks)
    .values({ ownerId: user.id, title, ...artist })
    .returning();
  const file = form.get("audio");
  if (file instanceof File && file.size) await uploadVersion(track.id, form);
  return redirect("/tracks/" + track.id);
}
export default function Library() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <div className="heading">
        <div>
          <a href="/releases">Artists & releases</a>
          <p className="eyebrow">YOUR LIBRARY</p>
          <h1>Music in progress.</h1>
        </div>
        <div>
          <a href="/account">{data.user.name}</a>
          {data.user.admin && (
            <p>
              <a href="/admin">Installation settings</a>
            </p>
          )}
          <Form method="post" action="/logout">
            <button className="secondary">Sign out</button>
          </Form>
        </div>
      </div>
      <Form method="get">
        <label>
          Sort
          <select name="sort" defaultValue={data.sort}>
            <option value="newest">Newest first</option>
            <option value="title">Title</option>
          </select>
        </label>
        <label>
          Find a track
          <input
            type="search"
            name="q"
            defaultValue={data.search}
            placeholder="Search your music…"
          />
        </label>
        <button>Search</button>
      </Form>
      <div className="grid">
        {data.tracks.map((track) => (
          <article className="panel" key={track.id}>
            <p className="eyebrow">TRACK</p>
            <h2>
              <a href={"/tracks/" + track.id}>{track.title}</a>
            </h2>
            <p className="muted">
              {track.description || "Ready for your first version."}
            </p>
          </article>
        ))}
      </div>
      {!data.tracks.length && (
        <p className="muted">
          Your library is quiet. Add a track to get started.
        </p>
      )}
      <Form method="post" encType="multipart/form-data" className="panel">
        <h2>New track</h2>
        <label>
          First version status
          <select name="status" defaultValue="work in progress">
            {versionStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          First audio version (optional)
          <input
            type="file"
            name="audio"
            onChange={(e) => {
              const file = e.target.files?.[0];
              const title = e.target.form?.elements.namedItem("title");
              if (file && title instanceof HTMLInputElement && !title.value)
                title.value = file.name
                  .replace(/\.[^.]+$/, "")
                  .replace(/[ _-]+v\d+(?:\.\d+)*$/i, "")
                  .replace(/_/g, " ");
            }}
          />
        </label>
        <label>
          Title
          <input name="title" required maxLength={200} />
        </label>
        <TrackArtistField profiles={data.artists} />
        <button>Create track</button>
        {result?.error && <p role="alert">{result.error}</p>}
      </Form>
    </>
  );
}

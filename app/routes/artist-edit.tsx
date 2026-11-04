import { ArtistCoOwners } from "../components/artist-coowners";
import { DemoList } from "../components/demo-list";
import { demoList } from "../server/demo-list";
import { manageArtistMembers } from "../server/artist-members";
import { Link } from "react-router";
import { ReleaseCardContent } from "../components/release-card-content";
import { Icon } from "../components/icons";
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
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { db } from "../server/db";
import {
  artists,
  releases,
  artistMembers,
  artistInvitations,
  users,
} from "../server/schema";
import { requireUser, sameOrigin, origin } from "../server/security";
import { uploadForm } from "../server/request";
import {
  directory,
  formError,
  ownedArtist,
  storeArtwork,
} from "../server/releases";
import { parseLinks } from "../domain/releases";
export async function loader({ request, params }: LoaderFunctionArgs) {
  const artist = await ownedArtist(request, params.id!);
  const user = await requireUser(request);
  const now = new Date();
  return {
    loadedAt: now.getTime(),
    artist,
    demos: await demoList(user.id, artist.id),
    membershipManager: artist.ownerId === user.id,
    invitationOrigin: origin,
    invitations:
      artist.ownerId === user.id
        ? await db
            .select()
            .from(artistInvitations)
            .where(
              and(
                eq(artistInvitations.artistId, artist.id),
                gt(artistInvitations.expires, now),
              ),
            )
            .orderBy(desc(artistInvitations.createdAt))
        : [],
    manager: (await db.query.users.findFirst({
      where: eq(users.id, artist.ownerId),
    }))!.name,
    members: await db
      .select({
        id: artistMembers.id,
        name: users.name,
      })
      .from(artistMembers)
      .innerJoin(users, eq(users.id, artistMembers.userId))
      .where(eq(artistMembers.artistId, artist.id))
      .orderBy(asc(users.name)),
    releases: await db
      .select()
      .from(releases)
      .where(eq(releases.artistId, artist.id))
      .orderBy(desc(releases.createdAt)),
  };
}
export async function action({ request, params }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  let upload: Awaited<ReturnType<typeof uploadForm>> | undefined;
  try {
    upload = await uploadForm(request, 11 * 1024 * 1024);
    const { form: f, files } = upload;
    const intent = f.get("intent");
    if (
      [
        "create-invitation",
        "revoke-invitation",
        "remove-member",
        "leave-artist",
      ].includes(String(intent))
    ) {
      await ownedArtist(request, params.id!);
      await manageArtistMembers(user.id, params.id!, f);
      if (f.has("_inline") && intent !== "leave-artist")
        return { saved: true, error: undefined };
      return redirect(
        intent === "leave-artist"
          ? "/artist-profiles"
          : `/artist-profiles/${params.id}`,
      );
    }
    if (intent === "edit-artist" || intent === "artist-links") {
      const previous = await ownedArtist(request, params.id!);
      const values = {
        ...(intent === "edit-artist"
          ? {
              name: z.string().trim().min(1).max(200).parse(f.get("name")),
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
      const file = files.get("image");
      if (!file) throw new Response("Choose an image", { status: 400 });
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
  } finally {
    await upload?.discard();
  }
}
export default function ArtistEdit() {
  const data = useLoaderData<typeof loader>();
  const { artist: a, releases: rows } = data;
  const result = useActionData<typeof action>();
  return (
    <>
      <div className="editor-toolbar">
        <Link to="/artist-profiles">Artists</Link>
        <PreviewLink href={`/artists/${a.slug}?preview=1`}>
          Preview artist page
        </PreviewLink>
      </div>
      <header className="music-editor-hero">
        <div className="artist-portrait-control">
          <div className="artist-portrait">
            {a.image ? (
              <img src={`/artist-images/${a.id}`} alt={a.name} />
            ) : (
              <span>{a.name.slice(0, 1)}</span>
            )}
          </div>
          <EditForm
            label="Artist image"
            trigger={<Icon name="image-plus" />}
            triggerLabel="Change image"
            encType="multipart/form-data"
            actions={<button className="button-primary">Save image</button>}
          >
            <input type="hidden" name="intent" value="artist-image" />
            <input type="hidden" name="id" value={a.id} />
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
          </EditForm>
        </div>
        <div>
          <p className="eyebrow">ARTIST</p>
          <h1>{a.name}</h1>
          <p className="artist-biography">
            {a.bio || "Add a biography to introduce your music."}
          </p>
          <div className="editor-controls">
            <EditForm
              label="Artist profile"
              trigger="Edit profile"
              actions={<button className="button-primary">Save profile</button>}
            >
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
            </EditForm>
          </div>
        </div>
      </header>
      {result?.error && <p role="alert">{result.error}</p>}
      <div className="artist-editor-columns">
        <div>
          <section>
            <div className="artist-section-heading">
              <h2>
                Releases <span className="section-count">{rows.length}</span>
              </h2>
              <Link
                className="artist-icon-action"
                to={`/releases?create=1&artist=${a.id}`}
                aria-label={`Add release for ${a.name}`}
                title={`Add release for ${a.name}`}
              >
                <Icon name="plus" />
              </Link>
            </div>
            <div className="catalog-grid">
              {rows.map((release) => (
                <Link
                  className="catalog-item"
                  to={`/releases/${release.id}`}
                  key={release.id}
                >
                  <ReleaseCardContent
                    releaseId={release.id}
                    title={release.title}
                    kind={release.kind}
                    releaseDate={release.metadata.releaseDate}
                    hasArtwork={!!release.cover}
                  />
                  <span
                    className={
                      release.published
                        ? "release-status published"
                        : "release-status"
                    }
                  >
                    {release.published && <Icon name="check-circle" />}
                    {release.published ? "Published" : "Draft"}
                  </span>
                </Link>
              ))}
            </div>
            {!rows.length && (
              <p>No releases yet. Create a draft to get started.</p>
            )}
          </section>
          <section
            className="artist-demo-list"
            aria-labelledby="artist-demos-heading"
          >
            <DemoList
              key={a.id}
              data={data.demos}
              emptyMessage="No demos linked to this artist yet."
            >
              <h2 id="artist-demos-heading">
                Work in progress{" "}
                <span className="section-count">
                  {data.demos.tracks.length}
                </span>
              </h2>
            </DemoList>
          </section>
        </div>
        <aside>
          <ArtistCoOwners data={data} />
          <div className="artist-section-heading">
            <h2>Links</h2>
            <EditForm
              label="Artist links"
              trigger={<Icon name="edit" />}
              triggerLabel="Edit links"
              actions={<button className="button-primary">Save links</button>}
            >
              <input type="hidden" name="intent" value="artist-links" />
              <LinkFields links={a.links} />
            </EditForm>
          </div>
          <ul className="artist-service-links">
            {a.links.map((link) => (
              <li key={link.url}>
                <a href={link.url} target="_blank" rel="noopener noreferrer">
                  <span className="artist-link-icon">
                    <Icon name="link" />
                  </span>
                  <span className="artist-link-details">
                    <span>{link.label}</span>
                    <span className="muted">{new URL(link.url).hostname}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          <p className="artist-links-note muted">Shown on your artist page.</p>
        </aside>
      </div>
    </>
  );
}

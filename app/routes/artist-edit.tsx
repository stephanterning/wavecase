import { useState } from "react";
import { manageArtistMembers } from "../server/artist-members";
import { ReleaseCardContent } from "../components/release-card-content";
import { Icon } from "../components/icons";
import { EditForm, PreviewLink } from "../components/editing";
import { LinkFields } from "../components/link-fields";
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
import { asc, desc, eq } from "drizzle-orm";
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
    membershipManager: artist.ownerId === (await requireUser(request)).id,
    invitationOrigin: origin,
    invitations:
      artist.ownerId === (await requireUser(request)).id
        ? await db
            .select()
            .from(artistInvitations)
            .where(eq(artistInvitations.artistId, artist.id))
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
  try {
    const f = await (await limitedBody(request, 11 * 1024 * 1024)).formData();
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
      return redirect(
        intent === "leave-artist"
          ? "/artist-profiles"
          : `/artist-profiles/${params.id}`,
      );
    }
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
  const {
    artist: a,
    releases: rows,
    membershipManager,
    manager,
    members,
    invitations,
    invitationOrigin,
  } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const [copyStatus, setCopyStatus] = useState("");
  return (
    <>
      <div className="editor-toolbar">
        <a href="/artist-profiles">Artists</a>
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
          </div>
        </div>
      </header>
      {result?.error && <p role="alert">{result.error}</p>}
      <section className="panel">
        <h2>Co-owners</h2>
        <p>
          All co-owners can upload, edit, publish and delete music, manage share
          links, and see discussions, feedback and statistics, including
          download email addresses.
        </p>
        <p>
          <strong>{manager}</strong> · Membership manager
        </p>
        {members.map((member) => (
          <div key={member.id}>
            <p>
              <strong>{member.name}</strong> · Co-owner
            </p>
            {membershipManager && (
              <Form
                method="post"
                onSubmit={(event) => {
                  if (
                    !window.confirm(
                      `Remove ${member.name}'s access? Their uploads and comments stay with the artist.`,
                    )
                  )
                    event.preventDefault();
                }}
              >
                <input type="hidden" name="member" value={member.id} />
                <button
                  className="secondary"
                  name="intent"
                  value="remove-member"
                >
                  Remove co-owner
                </button>
              </Form>
            )}
          </div>
        ))}
        {membershipManager ? (
          <>
            <h3>Invitation links</h3>
            <p>
              Each link can connect one account and expires after seven days.
              Anyone with the link can accept it. Send it directly to the person
              you want to invite.
            </p>
            {invitations.map((invitation) => (
              <div key={invitation.id}>
                <p>
                  <strong>{invitation.label}</strong> ·{" "}
                  {new Date(invitation.expires) > new Date()
                    ? `Expires ${new Date(invitation.expires).toISOString().slice(0, 10)}`
                    : "Expired"}
                </p>
                {new Date(invitation.expires) > new Date() && (
                  <>
                    <input
                      aria-label={`Invitation link for ${invitation.label}`}
                      readOnly
                      value={`${invitationOrigin}/artist-invitations/${invitation.id}`}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(
                            `${invitationOrigin}/artist-invitations/${invitation.id}`,
                          );
                          setCopyStatus("Invitation link copied.");
                        } catch {
                          setCopyStatus(
                            "Select the invitation link and copy it manually.",
                          );
                        }
                      }}
                    >
                      Copy invitation link
                    </button>
                  </>
                )}
                <Form method="post">
                  <input
                    type="hidden"
                    name="invitation"
                    value={invitation.id}
                  />
                  <button
                    className="secondary"
                    name="intent"
                    value="revoke-invitation"
                  >
                    Revoke invitation
                  </button>
                </Form>
              </div>
            ))}
            {copyStatus && <p role="status">{copyStatus}</p>}
            <Form method="post">
              <label>
                Invitation label (optional)
                <input name="label" maxLength={200} placeholder="e.g. Hugo" />
              </label>
              <button name="intent" value="create-invitation">
                Create invitation link
              </button>
            </Form>
          </>
        ) : (
          <Form
            method="post"
            onSubmit={(event) => {
              if (
                !window.confirm(
                  "Leave this artist? You will lose access to its private music and discussions. Your uploads and comments will remain.",
                )
              )
                event.preventDefault();
            }}
          >
            <button className="secondary" name="intent" value="leave-artist">
              Leave artist
            </button>
          </Form>
        )}
      </section>
      <div className="artist-editor-columns">
        <section>
          <div className="artist-section-heading">
            <h2>
              Releases <span className="section-count">{rows.length}</span>
            </h2>
            <a
              className="artist-icon-action"
              href={`/releases?create=1&artist=${a.id}`}
              aria-label={`Add release for ${a.name}`}
              title={`Add release for ${a.name}`}
            >
              <Icon name="plus" />
            </a>
          </div>
          <div className="catalog-grid">
            {rows.map((release) => (
              <a
                className="catalog-item"
                href={`/releases/${release.id}`}
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
              </a>
            ))}
          </div>
          {!rows.length && (
            <p>No releases yet. Create a draft to get started.</p>
          )}
        </section>
        <aside>
          <div className="artist-section-heading">
            <h2>Links</h2>
            <EditForm
              label="Artist links"
              trigger={<Icon name="edit" />}
              triggerLabel="Edit links"
            >
              <input type="hidden" name="intent" value="artist-links" />
              <input type="hidden" name="name" value={a.name} />
              <LinkFields links={a.links} />
              <button>Save links</button>
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

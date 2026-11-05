import { Link } from "react-router";
import type { loader } from "../routes/track";
import { ConfirmButton } from "./confirm-dialog";
import { EditForm, EditorDialog } from "./editing";
import { Icon } from "./icons";
import { PublicLink } from "./public-links";
import { TrackArtistField } from "./track-artist-field";
import { matchesConfirmation } from "../domain/confirmation";
import { versionStatuses } from "../domain/versions";

type Data = Awaited<ReturnType<typeof loader>>;
type Version = Data["versions"][number];

function ConfirmationField({
  label,
  expected,
}: {
  label: string;
  expected: string;
}) {
  return (
    <label>
      {label}
      <input
        name="confirmation"
        required
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onInput={(event) =>
          event.currentTarget.setCustomValidity(
            matchesConfirmation(event.currentTarget.value, expected)
              ? ""
              : `Type “${expected}” to confirm.`,
          )
        }
      />
    </label>
  );
}

export function DemoIdentity({
  data,
  artwork,
}: {
  data: Data;
  artwork?: string;
}) {
  const action = `/tracks/${data.track.id}`;
  return (
    <div className="demo-identity">
      <div className="demo-identity-text">
        <div className="demo-title-row">
          <h1>{data.track.title}</h1>
          {data.track.artist && (
            <p className="eyebrow">
              {data.artistUrl ? (
                <PublicLink
                  className="demo-artist"
                  to={data.artistUrl}
                  rel="noreferrer"
                >
                  {data.artistImageUrl && (
                    <img
                      src={data.artistImageUrl}
                      alt=""
                      width={32}
                      height={32}
                    />
                  )}
                  <span>{data.track.artist}</span>
                </PublicLink>
              ) : (
                data.track.artist
              )}
            </p>
          )}
          {data.owner && (
            <div className="track-edit-control">
              <EditorDialog title="Edit track" trigger="Edit track">
                <EditForm
                  label="Track details"
                  action={action}
                  modal
                  actions={
                    <button className="button-primary">Save track</button>
                  }
                >
                  <input type="hidden" name="intent" value="metadata" />
                  <label>
                    Title
                    <input
                      name="title"
                      defaultValue={data.track.title}
                      required
                      maxLength={200}
                    />
                  </label>
                  <TrackArtistField
                    confirmMove
                    profiles={data.artists}
                    artistId={data.track.artistId}
                    name={data.track.artist}
                  />
                  <label>
                    Description
                    <textarea
                      name="description"
                      defaultValue={data.track.description}
                      maxLength={5000}
                    />
                  </label>
                </EditForm>
                <div className="track-delete-section">
                  <EditForm
                    label="Delete track"
                    action={action}
                    trigger="Delete track"
                    actions={
                      <button className="button-danger">
                        Delete track permanently
                      </button>
                    }
                  >
                    <input type="hidden" name="intent" value="delete-track" />
                    <p>
                      Permanently delete <strong>{data.track.title}</strong>,
                      all versions, audio files, artwork, share links, feedback
                      and statistics? This cannot be undone.
                    </p>
                    <ConfirmationField
                      label="Type the track title to confirm"
                      expected={data.track.title}
                    />
                  </EditForm>
                </div>
              </EditorDialog>
            </div>
          )}
        </div>
        {data.track.description && (
          <p className="demo-description">{data.track.description}</p>
        )}
        {data.owner && (
          <Link to={`/tracks/${data.track.id}/analytics`}>
            Listening activity
          </Link>
        )}
      </div>
      {(artwork || data.owner) && (
        <div className="demo-artwork">
          {data.owner ? (
            <EditForm
              label="Cover image"
              trigger={artwork ? <img src={artwork} alt="" /> : "＋ Add cover"}
              triggerLabel={artwork ? "Change cover image" : undefined}
              encType="multipart/form-data"
              action={action}
              actions={
                <>
                  <button
                    className="button-primary"
                    name="intent"
                    value="cover"
                  >
                    Save cover
                  </button>
                  {artwork && (
                    <ConfirmButton
                      className="button-danger"
                      name="intent"
                      value="remove-cover"
                      formNoValidate
                      confirmTitle="Remove cover image?"
                      confirmMessage={
                        <p>
                          The cover of <strong>{data.track.title}</strong> will
                          be deleted from the workspace and all share links.
                          This cannot be undone.
                        </p>
                      }
                      confirmLabel="Remove cover"
                    >
                      Remove cover
                    </ConfirmButton>
                  )}
                </>
              }
            >
              <label>
                Cover image
                <input
                  name="cover"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                />
              </label>
            </EditForm>
          ) : (
            <img src={artwork} alt="Track cover" />
          )}
        </div>
      )}
    </div>
  );
}

export function VersionEditor({
  trackId,
  version,
}: {
  trackId: string;
  version: Version;
}) {
  const action = `/tracks/${trackId}`;
  return (
    <EditorDialog
      key={version.id}
      title="Edit version"
      trigger="Edit version"
      id="edit-version"
    >
      <EditForm
        label="Edit version"
        action={action}
        modal
        actions={<button className="button-primary">Save version</button>}
      >
        <input type="hidden" name="intent" value="version" />
        <input type="hidden" name="version" value={version.id} />
        <p className="version-filename">
          <span className="muted">File name: </span>
          {version.filename}
        </p>
        <label>
          Version name
          <input
            name="name"
            defaultValue={version.name}
            required
            maxLength={100}
          />
        </label>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={version.description}
            maxLength={5000}
          />
        </label>
        <label>
          Status
          <select name="status" defaultValue={version.status}>
            {versionStatuses.map((status) => (
              <option key={status}>{status}</option>
            ))}
          </select>
        </label>
        <label className="check">
          <input
            type="checkbox"
            name="download"
            defaultChecked={version.download}
          />
          Allow downloads
        </label>
        <p className="muted">
          Listener downloads also require permission on the share link.
        </p>
      </EditForm>
      <div className="track-delete-section">
        <EditForm
          label="Delete version"
          action={action}
          trigger="Delete version"
          actions={
            <button className="button-danger">
              Delete version permanently
            </button>
          }
        >
          <input type="hidden" name="intent" value="delete-version" />
          <input type="hidden" name="version" value={version.id} />
          <p>
            Permanently delete <strong>{version.name}</strong>, its audio files,
            feedback, replies and statistics? They will also be removed from all
            totals. This cannot be undone.
          </p>
          <p>
            The track, artwork, other versions and share links will remain.
            Links starting at this version will still only allow later versions.
            Links sharing only this version will have no available version.
          </p>
          <ConfirmationField
            label="Type the version name to confirm"
            expected={version.name}
          />
        </EditForm>
      </div>
    </EditorDialog>
  );
}

export function ReplaceAudio({
  trackId,
  version,
}: {
  trackId: string;
  version: Version;
}) {
  const missing = version.state === "missing";
  return (
    <div
      className={`replace-audio-control${version.state !== "ready" ? " always-visible" : ""}`}
    >
      <EditForm
        key={version.id}
        label={missing ? "Restore audio" : "Replace audio"}
        encType="multipart/form-data"
        action={`/tracks/${trackId}`}
        actions={
          <>
            <button
              className="button-primary"
              name="intent"
              value="replace"
              disabled={version.processing}
            >
              Upload replacement
            </button>
            {(version.state === "ready" || version.processing) && (
              <ConfirmButton
                name="intent"
                value="remove"
                formNoValidate
                className="button-danger"
                confirmTitle="Remove audio file?"
                confirmMessage={
                  <p>
                    The audio of <strong>{version.name}</strong> will be
                    deleted. The version, share links, feedback and statistics
                    will remain.
                  </p>
                }
                confirmLabel="Remove audio file"
              >
                Remove audio file
              </ConfirmButton>
            )}
          </>
        }
        trigger={
          missing ? (
            <span>
              <Icon name="upload" />
              Restore audio
            </span>
          ) : (
            <Icon name="upload" />
          )
        }
        triggerLabel={missing ? undefined : "Replace audio"}
      >
        <input type="hidden" name="version" value={version.id} />
        <p>
          Replace or restore the audio for <strong>{version.name}</strong>. The
          version and its share links stay the same. If it has comments, the
          replacement must have exactly the same duration.
        </p>
        <label>
          Audio file
          <input
            type="file"
            name="audio"
            required
            disabled={version.processing}
          />
        </label>
        {version.processing && (
          <p role="status">
            Audio is processing. Please wait before uploading another
            replacement.
          </p>
        )}
        {version.error && <p role="alert">{version.error}</p>}
      </EditForm>
    </div>
  );
}

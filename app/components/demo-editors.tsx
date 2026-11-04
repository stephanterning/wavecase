import { Link } from "react-router";
import type { loader } from "../routes/track";
import { EditForm, EditorDialog } from "./editing";
import { Icon } from "./icons";
import { PublicLink } from "./public-links";
import { TrackArtistField } from "./track-artist-field";
import { versionStatuses } from "../domain/versions";

type Data = Awaited<ReturnType<typeof loader>>;
type Version = Data["versions"][number];

export function DemoIdentity({
  data,
  artwork,
}: {
  data: Data;
  artwork?: string;
}) {
  const action = `/tracks/${data.track.id}/manage`;
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
                <EditForm label="Track details" action={action} modal>
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
                  <button>Save track</button>
                </EditForm>
                <div className="track-delete-section">
                  <EditForm
                    label="Delete track"
                    action={action}
                    trigger="Delete track"
                  >
                    <input type="hidden" name="intent" value="delete-track" />
                    <p>
                      Permanently delete <strong>{data.track.title}</strong>,
                      all versions, audio files, artwork, share links, feedback
                      and statistics? This cannot be undone.
                    </p>
                    <label>
                      Type the track title to confirm
                      <input name="confirmation" required autoComplete="off" />
                    </label>
                    <button className="danger">Delete track permanently</button>
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
              trigger={
                artwork ? (
                  <span title="Change cover image">
                    <img src={artwork} alt="Track cover" />
                    <span className="sr-only">Change cover image</span>
                  </span>
                ) : (
                  "＋ Add cover"
                )
              }
              encType="multipart/form-data"
              action={action}
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
              <button name="intent" value="cover">
                Save cover
              </button>
              {artwork && (
                <button
                  className="danger"
                  name="intent"
                  value="remove-cover"
                  formNoValidate
                >
                  Remove cover
                </button>
              )}
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
  return (
    <EditForm
      key={version.id}
      label="Edit version"
      action={`/tracks/${trackId}/manage`}
      trigger="Edit version"
    >
      <input type="hidden" name="intent" value="version" />
      <input type="hidden" name="version" value={version.id} />
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
      <button>Save version</button>
    </EditForm>
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
        label="Replace audio"
        encType="multipart/form-data"
        action={`/tracks/${trackId}/manage`}
        trigger={
          <span title={missing ? "Restore audio" : "Replace audio"}>
            <Icon name="upload" />
            {missing ? (
              "Restore audio"
            ) : (
              <span className="sr-only">Replace audio</span>
            )}
          </span>
        }
        onSubmit={(event) => {
          const submitter = (event.nativeEvent as SubmitEvent)
            .submitter as HTMLButtonElement | null;
          if (
            submitter?.value === "remove" &&
            !window.confirm(
              "Remove this audio file? The version, share links, feedback and statistics will remain.",
            )
          )
            event.preventDefault();
        }}
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
        <button name="intent" value="replace" disabled={version.processing}>
          Upload replacement
        </button>
        {(version.state === "ready" || version.processing) && (
          <button
            name="intent"
            value="remove"
            formNoValidate
            className="danger"
          >
            Remove audio file
          </button>
        )}
      </EditForm>
    </div>
  );
}

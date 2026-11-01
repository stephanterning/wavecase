import type { ReactNode } from "react";
import type { loader } from "../routes/track";
import { EditForm } from "./editing";
import { Icon } from "./icons";
import { PublicLink } from "./public-links";
import { TrackArtistField } from "./track-artist-field";
import { versionStatuses } from "../domain/versions";

type Data = Awaited<ReturnType<typeof loader>>;
type Version = Data["versions"][number];
export function EditIcon({ label }: { label: string }) {
  return (
    <span title={label}>
      <Icon name="edit" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function TrackField({
  data,
  field,
  label,
  children,
}: {
  data: Data;
  field: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <EditForm
      label={label}
      action={`/tracks/${data.track.id}/manage`}
      trigger={<EditIcon label={label} />}
    >
      <input type="hidden" name="intent" value="metadata" />
      <input type="hidden" name="field" value={field} />
      {children}
      <button>Save</button>
    </EditForm>
  );
}

export function DemoIdentity({
  data,
  artwork,
}: {
  data: Data;
  artwork?: string;
}) {
  return (
    <div className="demo-identity">
      <div className="demo-identity-text">
        <div className="inline-edit title-edit">
          <h1>{data.track.title}</h1>
          {data.owner && (
            <>
              <TrackField data={data} field="title" label="Edit track title">
                <label>
                  Title
                  <input
                    name="title"
                    defaultValue={data.track.title}
                    required
                    maxLength={200}
                  />
                </label>
              </TrackField>
              <details className="track-menu">
                <summary aria-label="Track actions" title="Track actions">
                  ⋯
                </summary>
                <EditForm
                  label="Delete track"
                  action={`/tracks/${data.track.id}/manage`}
                  trigger="Delete track"
                >
                  <input type="hidden" name="intent" value="delete-track" />
                  <p>
                    Permanently delete <strong>{data.track.title}</strong>, all
                    versions, audio files, artwork, share links, feedback and
                    statistics? This cannot be undone.
                  </p>
                  <label>
                    Type the track title to confirm
                    <input name="confirmation" required autoComplete="off" />
                  </label>
                  <button className="danger">Delete track permanently</button>
                </EditForm>
              </details>
            </>
          )}
        </div>
        <div className="inline-edit">
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
              data.track.artist ||
              (data.owner ? "Add artist" : "MUSIC IN PROGRESS")
            )}
          </p>
          {data.owner && (
            <TrackField data={data} field="artist" label="Edit track artist">
              <TrackArtistField
                profiles={data.artists}
                artistId={data.track.artistId}
                name={data.track.artist}
              />
            </TrackField>
          )}
        </div>
        <div className="inline-edit">
          {(data.track.description || data.owner) && (
            <p className="demo-description">
              {data.track.description || "Add description"}
            </p>
          )}
          {data.owner && (
            <TrackField
              data={data}
              field="description"
              label="Edit track description"
            >
              <label>
                Description
                <textarea
                  name="description"
                  defaultValue={data.track.description}
                  maxLength={5000}
                />
              </label>
            </TrackField>
          )}
        </div>
        {data.owner && (
          <a href={`/tracks/${data.track.id}/analytics`}>Listening activity</a>
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
              action={`/tracks/${data.track.id}/manage`}
            >
              <input type="hidden" name="intent" value="cover" />
              <label>
                Cover image
                <input
                  name="cover"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  required
                />
              </label>
              <button>Save cover</button>
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
  field,
}: {
  trackId: string;
  version: Version;
  field: "name" | "description" | "settings";
}) {
  const label =
    field === "name"
      ? "Edit version name"
      : field === "description"
        ? "Edit version description"
        : "Edit version settings";
  return (
    <EditForm
      key={version.id}
      label={label}
      action={`/tracks/${trackId}/manage`}
      trigger={<EditIcon label={label} />}
    >
      <input type="hidden" name="intent" value="version" />
      <input type="hidden" name="version" value={version.id} />
      <input type="hidden" name="field" value={field} />
      {field === "name" && (
        <label>
          Version name
          <input
            name="name"
            defaultValue={version.name}
            required
            maxLength={100}
          />
        </label>
      )}
      {field === "description" && (
        <label>
          Description
          <textarea
            name="description"
            defaultValue={version.description}
            maxLength={5000}
          />
        </label>
      )}
      {field === "settings" && (
        <>
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
        </>
      )}
      <button>Save</button>
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

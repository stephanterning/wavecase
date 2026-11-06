import { Form } from "react-router";
import type { loader } from "../routes/release-edit";
import { ConfirmButton } from "./confirm-dialog";
import { EditForm, PreviewLink } from "./editing";
import { Icon } from "./icons";
import { LinkFields } from "./link-fields";
import { metadataLabels, releaseFields, trackFields } from "../domain/releases";

type Data = Awaited<ReturnType<typeof loader>>;

function Fields({
  fields,
  values,
}: {
  fields: readonly string[];
  values: Record<string, unknown>;
}) {
  return (
    <div className="release-fields">
      {fields.map((field) => (
        <label key={field}>
          {metadataLabels[field]}
          {field === "songwriters" && (
            <small>Separate names with commas or semicolons.</small>
          )}
          {field === "credits" ? (
            <textarea
              name={field}
              defaultValue={String(values[field] || "")}
              maxLength={5000}
            />
          ) : (
            <input
              type={field === "releaseDate" ? "date" : "text"}
              name={field}
              defaultValue={String(values[field] || "")}
              maxLength={5000}
            />
          )}
        </label>
      ))}
    </div>
  );
}

export function ReleaseDetailsEditor({
  release,
  hasTracks,
  previewHref,
}: {
  release: Data["release"];
  hasTracks: boolean;
  previewHref: string;
}) {
  return (
    <>
      {!release.published && (
        <section
          className="panel publish-checklist"
          aria-label="Publication checklist"
        >
          <h2>Ready to publish?</h2>
          <ul>
            <li>
              {release.cover ? (
                "✓ Artwork added"
              ) : (
                <a href="#release-artwork">Add artwork</a>
              )}
            </li>
            <li>
              {hasTracks ? (
                "✓ Track list added"
              ) : (
                <a href="#release-tracks">Add at least one track</a>
              )}
            </li>
            <li>
              {release.audioEnabled ? (
                "✓ Playback and downloads enabled"
              ) : (
                <a href="#release-details">
                  Optional: enable playback and downloads
                </a>
              )}
            </li>
          </ul>
          <p>
            Audio and additional metadata are optional. A draft is only visible
            to you.
          </p>
        </section>
      )}
      <div
        className="release-actions"
        role="group"
        aria-label="Release actions"
      >
        <EditForm
          label="Release details"
          trigger={<Icon name="edit" />}
          triggerLabel="Edit release details"
          key={release.id}
          id="release-details"
          actions={<button className="button-primary">Save release</button>}
        >
          <input type="hidden" name="intent" value="metadata" />
          <label>
            Title
            <input
              name="title"
              required
              defaultValue={release.title}
              maxLength={200}
            />
          </label>
          <label>
            Type
            <select name="kind" defaultValue={release.kind}>
              <option value="single">Single</option>
              <option value="ep">EP</option>
              <option value="album">Album</option>
            </select>
          </label>
          <label>
            Description
            <textarea
              name="description"
              defaultValue={release.description}
              maxLength={5000}
            />
          </label>
          <Fields fields={["releaseDate", "genre"]} values={release.metadata} />
          <details>
            <summary>Credits and release identifiers</summary>
            <Fields
              fields={releaseFields.filter(
                (field) => field !== "releaseDate" && field !== "genre",
              )}
              values={release.metadata}
            />
          </details>
          <LinkFields links={release.links} label="Streaming and shop links" />
          <label className="check">
            <input
              type="checkbox"
              name="audioEnabled"
              defaultChecked={release.audioEnabled}
            />
            Enable playback and email-gated downloads together
          </label>
        </EditForm>
        <PreviewLink
          href={previewHref}
          label={release.published ? "View public page" : "Preview draft"}
        >
          <Icon name="eye" />
        </PreviewLink>
        <Form method="post">
          {release.published ? (
            <ConfirmButton
              className="icon-button tooltip"
              aria-label="Unpublish release"
              data-tooltip="Unpublish release"
              name="intent"
              value="unpublish"
              confirmTitle={`Unpublish “${release.title}”?`}
              confirmMessage={
                <p>
                  Its public page and downloads will become unavailable until
                  you publish again.
                </p>
              }
              confirmLabel="Unpublish"
            >
              <Icon name="eye-off" />
            </ConfirmButton>
          ) : (
            <>
              <button
                className="icon-button tooltip"
                aria-label="Publish release"
                data-tooltip="Publish release"
                name="intent"
                value="publish"
                disabled={!release.cover || !hasTracks}
              >
                <Icon name="eye" />
              </button>
              <ConfirmButton
                className="icon-button button-danger tooltip"
                aria-label="Delete draft"
                data-tooltip="Delete draft"
                name="intent"
                value="delete"
                confirmTitle={`Delete “${release.title}”?`}
                confirmMessage={
                  <p>
                    This permanently deletes the draft and all its tracks,
                    artwork, audio and activity. This cannot be undone.
                  </p>
                }
                confirmLabel="Delete draft"
              >
                <Icon name="trash" />
              </ConfirmButton>
            </>
          )}
        </Form>
      </div>
    </>
  );
}

export function ReleaseArtworkEditor({
  release,
}: {
  release: Data["release"];
}) {
  return (
    <div className="release-artwork-control">
      {release.cover ? (
        <img
          className="editor-cover"
          src={`/release-assets/${release.id}/cover`}
          alt="Release artwork"
        />
      ) : (
        <div className="editor-cover artwork-placeholder">Add artwork</div>
      )}
      <EditForm
        label="Artwork"
        trigger={<Icon name="image-plus" />}
        triggerLabel={release.cover ? "Change artwork" : "Add artwork"}
        encType="multipart/form-data"
        id="release-artwork"
        actions={<button className="button-primary">Upload artwork</button>}
      >
        <input type="hidden" name="intent" value="cover" />
        {release.cover && (
          <img
            className="release-thumb"
            src={`/release-assets/${release.id}/cover`}
            alt="Release artwork"
          />
        )}
        <label>
          PNG, JPG or WebP, up to 10 MB
          <input
            name="cover"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            required
          />
        </label>
      </EditForm>
    </div>
  );
}

export function TrackListEditor({
  tracks,
  published,
}: {
  tracks: Data["tracks"];
  published: boolean;
}) {
  return (
    <>
      <h2 id="release-tracks" tabIndex={-1}>
        Track list
      </h2>
      {tracks.map((t) => (
        <details className="panel release-track-editor" key={t.id}>
          <summary>
            <strong>
              {t.position}. {t.title}
            </strong>
            <span className="muted">
              {t.pendingOriginal
                ? "Processing audio…"
                : t.original
                  ? "Audio ready"
                  : "No audio"}
            </span>
          </summary>
          <EditForm
            label={`Track ${t.position}: ${t.title}`}
            trigger="Edit track"
            actions={<button className="button-primary">Save track</button>}
          >
            <input type="hidden" name="intent" value="track" />
            <input type="hidden" name="track" value={t.id} />
            <label>
              Track number
              <input
                type="number"
                name="position"
                min={1}
                max={999}
                required
                defaultValue={t.position}
              />
            </label>
            <label>
              Title
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={t.title}
              />
            </label>
            <Fields
              fields={["artist", "guests", "version"]}
              values={t.metadata}
            />
            <details>
              <summary>Credits and track identifiers</summary>
              <Fields
                fields={trackFields.filter(
                  (field) => !["artist", "guests", "version"].includes(field),
                )}
                values={t.metadata}
              />
            </details>
            <label className="check">
              <input
                type="checkbox"
                name="explicit"
                defaultChecked={t.metadata.explicit}
              />
              Explicit
            </label>
          </EditForm>
          <p>
            {t.original
              ? `WAV · ${t.bitDepth} bit · ${t.sampleRate} Hz`
              : "No audio uploaded"}
            {t.pendingOriginal && " · Processing upload…"}
          </p>
          {t.original && (t.bitDepth !== 24 || t.sampleRate !== 48000) && (
            <p className="muted">
              24-bit / 48 kHz is preferred. This master will be downloaded
              unchanged.
            </p>
          )}
          {t.error && <p role="alert">{t.error}</p>}
          <EditForm
            label={`Audio: ${t.title}`}
            trigger={t.original ? "Replace master" : "Upload master"}
            encType="multipart/form-data"
            actions={
              <button className="button-primary" disabled={!!t.pendingOriginal}>
                {t.original ? "Replace master" : "Upload master"}
              </button>
            }
          >
            <input type="hidden" name="intent" value="audio" />
            <input type="hidden" name="track" value={t.id} />
            <label>
              Master WAV (24-bit / 48 kHz preferred)
              <input
                name="audio"
                type="file"
                accept=".wav,audio/wav"
                required
                disabled={!!t.pendingOriginal}
              />
            </label>
          </EditForm>
          {(t.original || t.pendingOriginal) && (
            <Form method="post">
              <input type="hidden" name="track" value={t.id} />
              <ConfirmButton
                name="intent"
                value="remove-audio"
                confirmTitle={`Remove audio from “${t.title}”?`}
                confirmMessage={
                  <p>
                    The master and its downloads will be deleted. The track
                    stays in the release.{" "}
                    {published &&
                      "The public page will show it without audio immediately. "}
                    This cannot be undone.
                  </p>
                }
                confirmLabel="Remove audio"
              >
                Remove audio
              </ConfirmButton>
            </Form>
          )}
        </details>
      ))}
      <EditForm
        label="New track"
        trigger="＋ Add track"
        resetOnSave
        actions={<button className="button-primary">Add track</button>}
      >
        <input type="hidden" name="intent" value="add-track" />
        <label>
          New track title
          <input name="title" required maxLength={200} />
        </label>
        <p>
          Audio is optional. Add all tracks, including those without
          downloadable audio.
        </p>
      </EditForm>
    </>
  );
}

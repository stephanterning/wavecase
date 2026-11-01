import { useState } from "react";
import { EditForm, PreviewLink } from "./editing";
import { Icon } from "./icons";

type ShareLink = {
  id: string;
  label: string;
  active: boolean;
  download: boolean;
  fromOrder: number | null;
  plays: number;
  downloads: number;
};
type Version = { id: string; name: string; position: number };

export function ShareLinks({
  trackId,
  links,
  versions,
}: {
  trackId: string;
  links: ShareLink[];
  versions: Version[];
}) {
  const [notice, setNotice] = useState("");
  return (
    <section
      className="panel share-links-panel"
      id="share-links"
      aria-labelledby="share-links-heading"
    >
      <h2 id="share-links-heading">Share links</h2>
      <div className="share-links-toolbar">
        <EditForm
          label="New share link"
          trigger="＋ Create link"
          action={`/tracks/${trackId}`}
        >
          <input type="hidden" name="intent" value="link" />
          <label>
            Private label
            <input name="label" required maxLength={200} />
          </label>
          <label>
            Versions
            <select name="visibility" defaultValue="onward">
              <option value="all">All versions</option>
              <option value="onward">Latest and future versions</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" name="download" />
            Allow downloads
          </label>
          <button>Create link</button>
        </EditForm>
        <p className="muted" id="share-plays-help">
          Plays count listener playback starts across all versions, for all
          time. Replays count; your own plays do not. Downloads count listener
          requests, not completed transfers.
        </p>
      </div>
      {links.length ? (
        <table className="share-links-table">
          <caption className="sr-only">
            Share links and listening activity
          </caption>
          <thead>
            <tr>
              <th scope="col">Private label</th>
              <th scope="col">Status</th>
              <th scope="col">Download access</th>
              <th scope="col">Versions</th>
              <th scope="col">Plays</th>
              <th scope="col">Downloads</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.id}>
                <th scope="row" className="share-link-name">
                  {link.label}
                </th>
                <td data-label="Status">
                  {link.active ? "Active" : "Disabled"}
                </td>
                <td data-label="Download access">
                  <span
                    title={
                      link.download
                        ? "Downloads allowed when the version permits"
                        : "Downloads disabled"
                    }
                  >
                    {link.download ? "Allowed" : "Disabled"}
                  </span>
                </td>
                <td data-label="Versions">
                  {link.fromOrder
                    ? `From ${versions.find((v) => v.position === link.fromOrder)?.name || "selected version"} onward`
                    : "All versions"}
                </td>
                <td data-label="Plays">
                  <a
                    href={`/tracks/${trackId}/analytics?link=${encodeURIComponent(link.id)}`}
                    aria-label={`${link.plays} plays via ${link.label}. View activity`}
                    aria-describedby="share-plays-help"
                  >
                    {link.plays}
                  </a>
                </td>
                <td data-label="Downloads">
                  <a
                    href={`/tracks/${trackId}/analytics?link=${encodeURIComponent(link.id)}`}
                    aria-label={`${link.downloads} download requests via ${link.label}. View activity`}
                  >
                    {link.downloads}
                  </a>
                </td>
                <td className="share-link-actions">
                  <button
                    type="button"
                    className="icon-button"
                    title={`Copy link: ${link.label}`}
                    aria-label={`Copy link: ${link.label}`}
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/s/${link.id}`,
                        );
                        setNotice(`Link copied: ${link.label}`);
                      } catch {
                        setNotice("Could not copy the link. Please try again.");
                      }
                    }}
                  >
                    <Icon name="copy" />
                  </button>
                  {link.active ? (
                    <PreviewLink iconOnly href={`/s/${link.id}?preview=1`}>
                      <span title={`Preview as listener: ${link.label}`}>
                        <Icon name="eye" />
                        <span className="sr-only">
                          Preview as listener: {link.label}
                        </span>
                      </span>
                    </PreviewLink>
                  ) : (
                    <button
                      type="button"
                      className="icon-button"
                      disabled
                      title="Enable this link to preview it"
                      aria-label={`Preview unavailable: ${link.label} is disabled`}
                    >
                      <Icon name="eye" />
                    </button>
                  )}
                  <EditForm
                    label={`Share link: ${link.label}`}
                    action={`/tracks/${trackId}/manage`}
                    trigger={
                      <span title={`Edit link: ${link.label}`}>
                        <Icon name="edit" />
                        <span className="sr-only">Edit link: {link.label}</span>
                      </span>
                    }
                  >
                    <input type="hidden" name="intent" value="link" />
                    <input type="hidden" name="link" value={link.id} />
                    <label>
                      Private label
                      <input
                        name="label"
                        defaultValue={link.label}
                        required
                        maxLength={200}
                      />
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="active"
                        defaultChecked={link.active}
                      />
                      Active
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="download"
                        defaultChecked={link.download}
                      />
                      Allow downloads
                    </label>
                    <label>
                      Visible versions
                      <select
                        name="from"
                        defaultValue={
                          link.fromOrder
                            ? versions.find(
                                (v) => v.position === link.fromOrder,
                              )?.id || ""
                            : ""
                        }
                      >
                        <option value="">All versions</option>
                        {versions.map((v) => (
                          <option key={v.id} value={v.id}>
                            From {v.name} onward
                          </option>
                        ))}
                      </select>
                    </label>
                    <button>Save link</button>
                  </EditForm>
                  <EditForm
                    label={`Delete share link: ${link.label}`}
                    action={`/tracks/${trackId}/manage`}
                    trigger={
                      <span title={`Delete link: ${link.label}`}>
                        <Icon name="trash" />
                        <span className="sr-only">
                          Delete link: {link.label}
                        </span>
                      </span>
                    }
                  >
                    <input type="hidden" name="intent" value="delete-link" />
                    <input type="hidden" name="link" value={link.id} />
                    <input type="hidden" name="confirm" value="delete" />
                    <p>
                      Permanently delete <strong>{link.label}</strong> and all
                      feedback, replies and statistics from this link? They will
                      also be removed from all totals. This cannot be undone.
                    </p>
                    <p>
                      The shared URL will stop working. Other links and the
                      track will remain.
                    </p>
                    <button className="danger">Delete link permanently</button>
                  </EditForm>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="muted">
          No share links yet. Create a link to invite listeners.
        </p>
      )}
      <p role="status" className="share-link-notice">
        {notice}
      </p>
    </section>
  );
}

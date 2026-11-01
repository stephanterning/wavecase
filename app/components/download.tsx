import { useState } from "react";
import { Icon } from "./icons";
import { listenerIdentity } from "./telemetry";
import {
  DownloadDialog,
  DownloadEmail,
  DownloadFormats,
} from "./download-dialog";

export function Download({
  versionId,
  versionName,
  share,
  owner,
  wav,
  preview = false,
}: {
  versionId: string;
  versionName: string;
  share?: string;
  owner: boolean;
  wav: boolean;
  preview?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-action"
        aria-label="Download audio"
        onClick={() => setOpen(true)}
      >
        <Icon name="download" />
      </button>
      {open && (
        <DownloadDialog
          title={versionName}
          preview={preview}
          action={"/media/" + versionId + (preview ? "?preview=1" : "")}
          onClose={() => setOpen(false)}
          onSubmit={(event) => {
            if (share && !owner && !preview) {
              const identity = listenerIdentity(share);
              for (const field of ["browser", "session"] as const)
                (
                  event.currentTarget.elements.namedItem(
                    field,
                  ) as HTMLInputElement
                ).value = identity[field];
            }
          }}
        >
          {share && <input type="hidden" name="share" value={share} />}
          {!owner && (
            <>
              <input type="hidden" name="browser" />
              <input type="hidden" name="session" />
            </>
          )}
          <p>
            <strong>Pre-release version. Do not share.</strong>
          </p>
          <p className="muted">
            The ZIP includes this version’s audio, artwork if available, and
            demo-info.txt with track and version information.
          </p>
          <DownloadFormats
            wav={wav}
            detailsUrl={`/media/${versionId}?${new URLSearchParams({ "download-info": "1", ...(share ? { share } : {}), ...(preview ? { preview: "1" } : {}) })}`}
          />
          {!owner && <DownloadEmail ownerLabel="demo owner" />}
        </DownloadDialog>
      )}
    </>
  );
}

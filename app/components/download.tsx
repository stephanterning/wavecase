import { useState } from "react";
import { Icon } from "./icons";
import { listenerIdentity } from "./telemetry";
import { DownloadDialog, DownloadEmail } from "./download-dialog";

export function Download({
  versionId,
  versionName,
  share,
  owner,
  modern,
  wav,
}: {
  versionId: string;
  versionName: string;
  share?: string;
  owner: boolean;
  modern: boolean;
  wav: boolean;
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
          action={"/media/" + versionId}
          onClose={() => setOpen(false)}
          onSubmit={(event) => {
            if (share && !owner) {
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
          {modern ? (
            <fieldset className="download-formats">
              <legend>Format</legend>
              {wav && (
                <label className="check">
                  <input
                    type="radio"
                    name="format"
                    value="wav"
                    defaultChecked
                  />{" "}
                  WAV
                </label>
              )}
              <label className="check">
                <input
                  type="radio"
                  name="format"
                  value="mp3"
                  defaultChecked={!wav}
                />{" "}
                MP3 · 320 kbps
              </label>
            </fieldset>
          ) : (
            <>
              <input type="hidden" name="format" value="original" />
              <p>Original audio format</p>
            </>
          )}
          {!owner && <DownloadEmail ownerLabel="demo owner" />}
          {modern && (
            <p className="muted">
              The first MP3 download may take a moment to prepare.
            </p>
          )}
        </DownloadDialog>
      )}
    </>
  );
}

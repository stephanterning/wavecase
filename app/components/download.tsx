import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { listenerIdentity } from "./telemetry";

export function Download({
  versionId,
  versionName,
  share,
  wav,
}: {
  versionId: string;
  versionName: string;
  share?: string;
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
          versionId={versionId}
          versionName={versionName}
          share={share}
          wav={wav}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function DownloadDialog({
  versionId,
  versionName,
  share,
  wav,
  onClose,
}: {
  versionId: string;
  versionName: string;
  share?: string;
  wav: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [submitted, setSubmitted] = useState(false);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="comment-dialog"
      aria-labelledby="download-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">{versionName}</p>
          <h2 id="download-title">Download audio</h2>
        </div>
        <button
          type="button"
          className="icon-action"
          aria-label="Close download"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <form
        action={"/media/" + versionId}
        method="get"
        onSubmit={(event) => {
          if (share) {
            const identity = listenerIdentity(share);
            for (const field of ["browser", "session"] as const)
              (
                event.currentTarget.elements.namedItem(
                  field,
                ) as HTMLInputElement
              ).value = identity[field];
          }
          setSubmitted(true);
        }}
      >
        <input type="hidden" name="download" value="1" />
        {share && (
          <>
            <input type="hidden" name="share" value={share} />
            <input type="hidden" name="browser" />
            <input type="hidden" name="session" />
          </>
        )}
        <fieldset className="download-formats">
          <legend>Format</legend>
          {wav && (
            <label className="check">
              <input type="radio" name="format" value="wav" defaultChecked />{" "}
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
        <p className="muted">
          The first MP3 download may take a moment to prepare.
        </p>
        {submitted && (
          <p role="status">Your download will start when the file is ready.</p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
          <button type="submit">Download</button>
        </div>
      </form>
    </dialog>
  );
}

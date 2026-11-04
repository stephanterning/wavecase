import {
  formatDownloadDetails,
  type DownloadDetails,
} from "../domain/download-details";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import { Icon } from "./icons";

export function DownloadDialog({
  title,
  action,
  children,
  onClose,
  onSubmit,
  preview = false,
}: {
  preview?: boolean;
  title: string;
  action: string;
  children: ReactNode;
  onClose: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
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
      className="comment-dialog download-dialog"
      aria-labelledby={heading}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">{title}</p>
          <h2 id={heading}>Download audio</h2>
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
        action={action}
        method="post"
        onSubmit={(event) => {
          if (preview) event.preventDefault();
          else onSubmit?.(event);
          setSubmitted(true);
        }}
      >
        {children}
        {submitted && (
          <p role="status">
            {preview
              ? "Preview only. No download was requested and no email was saved."
              : "Your download will start when the ZIP is ready."}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
          <button type="submit" className="button-primary">
            Download ZIP
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function DownloadEmail({ ownerLabel }: { ownerLabel: string }) {
  return (
    <>
      <label>
        Email address
        <input
          type="email"
          name="email"
          required
          maxLength={254}
          autoComplete="email"
        />
      </label>
      <p className="muted">
        Your address is shared with the {ownerLabel} and saved with this
        download request. No verification email or mailing-list subscription.
      </p>
    </>
  );
}

export function DownloadFormats({
  wav = true,
  detailsUrl,
}: {
  wav?: boolean;
  detailsUrl: string;
}) {
  const [result, setResult] = useState<{ url: string; data?: DownloadDetails }>(
    { url: "" },
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetch(detailsUrl, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Details unavailable");
        return response.json() as Promise<DownloadDetails>;
      })
      .then((data) => {
        if (!controller.signal.aborted) setResult({ url: detailsUrl, data });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ url: detailsUrl });
      });
    return () => controller.abort();
  }, [detailsUrl]);
  const data = result.url === detailsUrl ? result.data : undefined;
  return (
    <>
      <fieldset className="download-formats">
        <legend>Format</legend>
        {wav && (
          <label className="check">
            <input type="radio" name="format" value="wav" defaultChecked />
            <span>
              WAV · 16 bit / 44.1 kHz
              {data?.wav && <small>{formatDownloadDetails(data.wav)}</small>}
            </span>
          </label>
        )}
        {wav && (
          <label className="check">
            <input type="radio" name="format" value="flac" />
            <span>
              FLAC · 16 bit / 44.1 kHz
              {data?.flac && <small>{formatDownloadDetails(data.flac)}</small>}
              <small>
                Lossless compression. Requires a player that supports FLAC.
              </small>
            </span>
          </label>
        )}
        <label className="check">
          <input type="radio" name="format" value="mp3" defaultChecked={!wav} />{" "}
          <span>
            MP3 · 320 kbps
            {data && <small>{formatDownloadDetails(data.mp3)}</small>}
          </span>
        </label>
        <label className="check">
          <input type="radio" name="format" value="original" />
          <span>
            {data
              ? data.originalPreserved
                ? "Original upload"
                : "Stored master"
              : "Original / stored master"}
            {data && <small>{formatDownloadDetails(data.original)}</small>}
          </span>
        </label>
      </fieldset>
      {data && !data.originalPreserved && (
        <p className="muted">
          This older upload uses the stored master. Its resolution may differ
          from the original upload.
        </p>
      )}
      {!data && (
        <p className="muted" role="status">
          {result.url === detailsUrl
            ? "Size and audio details are currently unavailable."
            : "Checking size and audio details…"}
        </p>
      )}
      {data && (
        <p className="muted">
          ZIP sizes include artwork and metadata. WAV and MP3 sizes are
          estimated until prepared; FLAC size is shown after preparation.
        </p>
      )}
      {!wav && (
        <p className="muted">
          WAV and FLAC are unavailable because the upload uses lossy
          compression.
        </p>
      )}
      <p className="muted">
        The first download in a new format may take a moment to prepare.
      </p>
    </>
  );
}

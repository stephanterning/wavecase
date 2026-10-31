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
}: {
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
      className="comment-dialog"
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
          onSubmit?.(event);
          setSubmitted(true);
        }}
      >
        {children}
        {submitted && (
          <p role="status">Your download will start when the ZIP is ready.</p>
        )}
        <div className="dialog-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
          <button type="submit">Download ZIP</button>
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

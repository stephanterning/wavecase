import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
export type CommentDraft = {
  versionId: string;
  threadId?: string;
  start: number | null;
  end: number | null;
};
export function CommentDialog({
  draft,
  owner,
  versionName,
  error,
  onSubmit,
  onClose,
}: {
  draft: CommentDraft;
  owner: boolean;
  versionName: string;
  error: string;
  onSubmit: (form: HTMLFormElement, draft: CommentDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [name] = useState(() => localStorage.getItem("wavecase.name") || "");
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    const nameField =
      element.querySelector<HTMLInputElement>('input[name="name"]');
    if (nameField && !nameField.value.trim()) nameField.focus();
    else element.querySelector<HTMLTextAreaElement>("textarea")?.focus();
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
      aria-labelledby="comment-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !pending) {
          const bounds = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < bounds.left ||
            event.clientX > bounds.right ||
            event.clientY < bounds.top ||
            event.clientY > bounds.bottom
          )
            onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <div>
          <p className="eyebrow">{versionName}</p>
          <h2 id="comment-dialog-title">
            {draft.threadId ? "Reply" : "Add comment"}
          </h2>
        </div>
        <button
          type="button"
          className="icon-action"
          aria-label="Close comment"
          disabled={pending}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          const saved = await onSubmit(event.currentTarget, draft);
          setPending(false);
          if (saved) onClose();
        }}
      >
        {!owner && (
          <label>
            Your name
            <input
              name="name"
              required
              maxLength={100}
              defaultValue={name}
              autoFocus={!name}
            />
          </label>
        )}
        <label>
          {draft.threadId ? "Reply" : "Comment"}
          <textarea
            name="body"
            required
            maxLength={5000}
            rows={5}
            autoFocus={owner || !!name}
          />
        </label>
        {!draft.threadId && draft.start !== null && (
          <div className="grid">
            <label>
              Start time (seconds)
              <input
                type="number"
                name="start"
                min="0"
                step="0.01"
                required
                defaultValue={draft.start}
              />
            </label>
            {draft.end !== null && (
              <label>
                End time (seconds)
                <input
                  type="number"
                  name="end"
                  min="0"
                  step="0.01"
                  required
                  defaultValue={draft.end}
                />
              </label>
            )}
          </div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            disabled={pending}
          >
            Cancel
          </button>
          <button type="submit" disabled={pending}>
            {pending
              ? "Sending…"
              : draft.threadId
                ? "Send reply"
                : "Send comment"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

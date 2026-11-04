import { commentTime } from "../domain/comment-time";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./modal";
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
  visibility,
  error,
  onSubmit,
  onClose,
}: {
  draft: CommentDraft;
  owner: boolean;
  versionName: string;
  visibility?: string;
  error: string;
  onSubmit: (form: HTMLFormElement, draft: CommentDraft) => Promise<boolean>;
  onClose: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [name] = useState(() => localStorage.getItem("wavecase.name") || "");
  useEffect(() => {
    const nameField =
      form.current!.querySelector<HTMLInputElement>('input[name="name"]');
    if (nameField && !nameField.value.trim()) nameField.focus();
    else form.current!.querySelector("textarea")?.focus();
  }, []);
  return (
    <Modal
      open
      onClose={() => {
        if (!pending) onClose();
      }}
      title={draft.threadId ? "Reply" : "Add comment"}
      eyebrow={versionName}
      closeLabel="Close comment"
    >
      <form
        ref={form}
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending) return;
          setPending(true);
          const saved = await onSubmit(event.currentTarget, draft);
          setPending(false);
          if (saved) onClose();
        }}
      >
        {visibility && <p className="muted">{visibility}</p>}
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
              Start time (minutes:seconds)
              <input
                type="text"
                name="startTime"
                pattern="[0-9]+:[0-5][0-9]([.][0-9]{1,2})?"
                placeholder="0:00"
                required
                defaultValue={commentTime(draft.start)}
              />
            </label>
            {draft.end !== null && (
              <label>
                End time (minutes:seconds)
                <input
                  type="text"
                  name="endTime"
                  pattern="[0-9]+:[0-5][0-9]([.][0-9]{1,2})?"
                  placeholder="0:00"
                  required
                  defaultValue={commentTime(draft.end)}
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
    </Modal>
  );
}

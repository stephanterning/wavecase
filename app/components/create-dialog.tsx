import { useEffect, useId, useRef } from "react";
import { useSearchParams } from "react-router";

export function CreateDialog({
  title,
  error,
  children,
}: {
  title: string;
  error?: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [search] = useSearchParams();
  const id = useId();
  useEffect(() => {
    if ((search.get("create") === "1" || error) && !dialog.current?.open)
      dialog.current?.showModal();
  }, [search, error]);
  return (
    <>
      <button ref={trigger} onClick={() => dialog.current?.showModal()}>
        {title}
      </button>
      <dialog
        ref={dialog}
        className="comment-dialog"
        aria-labelledby={id}
        onClose={() => trigger.current?.focus()}
      >
        <div className="dialog-actions">
          <h2 id={id}>{title}</h2>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close
          </button>
        </div>
        {children}
        {error && <p role="alert">{error}</p>}
      </dialog>
    </>
  );
}

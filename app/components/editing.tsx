import {
  Children,
  isValidElement,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker, useFetcher, type FormProps } from "react-router";

const DialogActions = createContext<{
  cancel: () => void;
  complete: () => void;
} | null>(null);

type Editor = {
  label: string;
  dirty: () => boolean;
  save: () => Promise<boolean>;
};
const Editing = createContext<Map<HTMLFormElement, Editor> | null>(null);
export function EditingProvider({ children }: { children: ReactNode }) {
  const [editors] = useState(() => new Map<HTMLFormElement, Editor>());
  const dirty = () => [...editors.values()].some((editor) => editor.dirty());
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty() &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useEffect(() => {
    if (blocker.state === "blocked") {
      if (window.confirm("Leave this page? Your unsaved changes will be lost."))
        blocker.proceed();
      else blocker.reset();
    }
  }, [blocker]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });
  return <Editing.Provider value={editors}>{children}</Editing.Provider>;
}

export function useConfirmDiscard() {
  const editors = useContext(Editing);
  return (labels: string[]) => {
    const changed = [...(editors?.values() || [])].some(
      (editor) => labels.includes(editor.label) && editor.dirty(),
    );
    return (
      !changed ||
      window.confirm(
        "Switch version? Unsaved version settings and audio selections will be lost.",
      )
    );
  };
}

function snapshot(form: HTMLFormElement) {
  return JSON.stringify(
    [...new FormData(form)]
      .filter(([key, value]) => {
        // Empty file controls are equivalent to disabled upload controls.
        if (value instanceof File && !value.name) return false;
        const field = form.elements.namedItem(key);
        return !(
          field instanceof HTMLInputElement &&
          field.type === "hidden" &&
          key !== "links"
        );
      })
      .map(([key, value]) => [
        key,
        typeof value === "string"
          ? value
          : [value.name, value.size, value.lastModified],
      ]),
  );
}

function FormContents({
  label,
  children,
  resetOnSave = false,
  modal = false,
  ...props
}: FormProps & {
  label: string;
  resetOnSave?: boolean;
  modal?: boolean;
}) {
  const dialogActions = useContext(DialogActions);
  const onSaved = modal ? dialogActions?.complete : undefined;
  const onCancel = modal ? dialogActions?.cancel : undefined;
  const editors = useContext(Editing);
  const fetcher = useFetcher<{
    saved?: boolean;
    ok?: boolean;
    error?: string;
  }>();
  const ref = useRef<HTMLFormElement>(null);
  const baseline = useRef("");
  const submitted = useRef("");
  const resolveSave = useRef<((ok: boolean) => void) | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const busy = fetcher.state !== "idle";
  useEffect(() => {
    const form = ref.current!;
    baseline.current = snapshot(form);
  }, []);
  useEffect(() => {
    const form = ref.current!;
    editors?.set(form, {
      label,
      dirty: () => !!submitted.current || snapshot(form) !== baseline.current,
      save: () => {
        if (submitted.current) return Promise.resolve(false);
        if (!form.checkValidity()) {
          const details = form.closest("details");
          if (details) details.open = true;
          return Promise.resolve(false);
        }
        return new Promise<boolean>((resolve) => {
          resolveSave.current = resolve;
          form.requestSubmit(
            form.querySelector<HTMLButtonElement>(
              'button:not([type="button"])',
            ) || undefined,
          );
        });
      },
    });
    return () => {
      editors?.delete(form);
    };
  }, [editors, label]);
  useEffect(() => {
    if (fetcher.state !== "idle" || !submitted.current) return;
    const ok =
      !!(fetcher.data?.saved || fetcher.data?.ok) && !fetcher.data?.error;
    if (ok) {
      if (resetOnSave) ref.current!.reset();
      for (const field of ref.current!.querySelectorAll<HTMLInputElement>(
        'input[type="file"]',
      ))
        field.value = "";
      baseline.current = snapshot(ref.current!);
      setDirty(snapshot(ref.current!) !== baseline.current);
      setSaved(true);
      onSaved?.();
    }
    submitted.current = "";
    resolveSave.current?.(ok);
    resolveSave.current = null;
  }, [fetcher.state, fetcher.data, resetOnSave, onSaved]);
  const parts = Children.toArray(children);
  const submit = (child: ReactNode) =>
    isValidElement<{ type?: string }>(child) &&
    child.type === "button" &&
    child.props.type !== "button";
  const refresh = () =>
    queueMicrotask(() => {
      if (!ref.current) return;
      setDirty(snapshot(ref.current) !== baseline.current);
      setSaved(false);
    });
  return (
    <fetcher.Form
      {...props}
      ref={ref}
      method="post"
      onInvalidCapture={(event) => {
        const field = event.target as HTMLElement;
        const details = field.closest("details");
        if (details) details.open = true;
      }}
      onInput={refresh}
      onChange={refresh}
      onSubmit={(event) => {
        props.onSubmit?.(event);
        if (event.defaultPrevented) {
          resolveSave.current?.(false);
          resolveSave.current = null;
          return;
        }
        submitted.current = snapshot(event.currentTarget);
      }}
    >
      <input type="hidden" name="_inline" value="1" />
      <fieldset disabled={busy} className="edit-fields">
        <legend className="sr-only">{label}</legend>
        {onCancel ? (
          <>
            {parts.filter((child) => !submit(child))}
            <div className="editor-footer">
              <button type="button" onClick={onCancel}>
                Cancel
              </button>
              {parts.filter(submit)}
            </div>
          </>
        ) : (
          children
        )}
      </fieldset>
      <p className="save-status" role="status">
        {busy
          ? `Saving ${label.toLowerCase()}…`
          : dirty
            ? `${label}: unsaved changes`
            : saved
              ? `${label} saved`
              : ""}
      </p>
      {fetcher.data?.error && <p role="alert">{fetcher.data.error}</p>}
    </fetcher.Form>
  );
}

export function PreviewLink({
  href,
  children,
  iconOnly = false,
}: {
  href: string;
  children: ReactNode;
  iconOnly?: boolean;
}) {
  const editors = useContext(Editing);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLAnchorElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const open = () => window.open(href, "_blank", "noopener,noreferrer");
  return (
    <>
      <a
        ref={trigger}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(event) => {
          const dirty = [...(editors?.values() || [])].filter((editor) =>
            editor.dirty(),
          );
          if (!dirty.length) return;
          event.preventDefault();
          setLabels(dirty.map((editor) => editor.label));
          setError("");
          dialog.current?.showModal();
        }}
      >
        {children} {!iconOnly && <span aria-hidden="true">↗</span>}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <dialog
        ref={dialog}
        className="comment-dialog"
        aria-label="Unsaved changes before preview"
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
        onClose={() => trigger.current?.focus()}
      >
        <h2>Unsaved changes</h2>
        <p>
          Preview shows saved content. These sections have changes:{" "}
          {labels.join(", ")}.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button disabled={busy} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={() => {
              open();
              dialog.current?.close();
            }}
          >
            Preview saved version
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              // Open synchronously so browsers do not block the tab after saving.
              const preview = window.open("about:blank", "_blank");
              if (preview) preview.opener = null;
              setBusy(true);
              try {
                for (const editor of [...(editors?.values() || [])]) {
                  if (editor.dirty() && !(await editor.save())) {
                    preview?.close();
                    setError(
                      `Could not save ${editor.label.toLowerCase()}. Check that section and try again.`,
                    );
                    return;
                  }
                }
                if (preview) preview.location.replace(href);
                else open();
                dialog.current?.close();
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save and preview"}
          </button>
        </div>
      </dialog>
    </>
  );
}

/** Mount editors only while open, so Cancel also discards controlled fields. */
export function EditorDialog({
  title,
  trigger,
  id,
  className = "",
  children,
}: {
  title: string;
  trigger: ReactNode;
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const editors = useContext(Editing);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else if (wasOpen.current) button.current?.focus();
    wasOpen.current = open;
  }, [open]);
  const complete = () => setOpen(false);
  const cancel = () => {
    if (dialog.current?.querySelector("fieldset:disabled")) return;
    const dirty = [...(editors?.entries() || [])].some(
      ([form, editor]) => dialog.current?.contains(form) && editor.dirty(),
    );
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    complete();
  };
  return (
    <>
      <button
        type="button"
        className="editor-trigger"
        id={id}
        ref={button}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </button>
      {open && (
        <dialog
          ref={dialog}
          className={`comment-dialog editor-dialog ${className}`}
          aria-label={title}
          onCancel={(event) => {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
        >
          <div className="dialog-heading">
            <h2>{title}</h2>
            <button type="button" aria-label="Close editor" onClick={cancel}>
              ×
            </button>
          </div>
          <DialogActions.Provider value={{ cancel, complete }}>
            {children}
          </DialogActions.Provider>
        </dialog>
      )}
    </>
  );
}
export function EditForm({
  trigger,
  id,
  ...props
}: FormProps & { label: string; resetOnSave?: boolean; trigger?: ReactNode }) {
  return trigger ? (
    <EditorDialog title={props.label} trigger={trigger} id={id}>
      <FormContents {...props} modal />
    </EditorDialog>
  ) : (
    <FormContents {...props} id={id} />
  );
}

export function CloseEditor() {
  const actions = useContext(DialogActions);
  return (
    <div className="editor-footer">
      <button type="button" onClick={actions?.cancel}>
        Close
      </button>
    </div>
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker, useFetcher, type FormProps } from "react-router";
import { ConfirmDialog } from "./confirm-dialog";
import { Modal } from "./modal";

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
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  });
  return (
    <Editing.Provider value={editors}>
      {children}
      <ConfirmDialog
        open={blocker.state === "blocked"}
        title="Leave this page?"
        confirmLabel="Discard and leave"
        cancelLabel="Stay on page"
        onConfirm={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        <p>
          {blocker.state === "blocked" &&
            `Unsaved changes will be lost: ${[...editors.values()]
              .filter((editor) => editor.dirty())
              .map((editor) => editor.label)
              .join(", ")}.`}
        </p>
      </ConfirmDialog>
    </Editing.Provider>
  );
}

function snapshot(form: HTMLFormElement) {
  return JSON.stringify(
    [...new FormData(form)]
      .filter(([key, value]) => {
        // Empty file controls are equivalent to disabled upload controls.
        if (value instanceof File && !value.name) return false;
        // Typing a delete confirmation is not an edit worth keeping.
        if (key === "confirmation") return false;
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

type FormContentsProps = FormProps & {
  label: string;
  /** Submit and other form buttons, placed after Cancel in a modal's footer. */
  actions?: ReactNode;
  resetOnSave?: boolean;
  modal?: boolean;
  onSuccess?: (data: object) => void;
};

function FormContents({
  label,
  actions,
  children,
  resetOnSave = false,
  modal = false,
  onSuccess,
  ...props
}: FormContentsProps) {
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
      onSuccess?.(fetcher.data!);
    }
    submitted.current = "";
    resolveSave.current?.(ok);
    resolveSave.current = null;
  }, [fetcher.state, fetcher.data, resetOnSave, onSaved, onSuccess]);
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
        {children}
        {onCancel ? (
          <div className="editor-footer">
            <button type="button" className="secondary" onClick={onCancel}>
              Cancel
            </button>
            {actions}
          </div>
        ) : (
          actions
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
  const trigger = useRef<HTMLAnchorElement>(null);
  const [labels, setLabels] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = () => window.open(href, "_blank", "noopener,noreferrer");
  const close = () => {
    if (!busy) setLabels(null);
  };
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
        }}
      >
        {children} {!iconOnly && <span aria-hidden="true">↗</span>}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
      <Modal
        open={!!labels}
        onClose={close}
        title="Unsaved changes"
        trigger={trigger}
      >
        <p>
          Preview shows saved content. These sections have changes:{" "}
          {labels?.join(", ")}.
        </p>
        {error && <p role="alert">{error}</p>}
        <div className="dialog-actions">
          <button disabled={busy} onClick={close}>
            Cancel
          </button>
          <button
            disabled={busy}
            onClick={() => {
              open();
              setLabels(null);
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
                setLabels(null);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving…" : "Save and preview"}
          </button>
        </div>
      </Modal>
    </>
  );
}

/** Mount editors only while open, so Cancel also discards controlled fields. */
export function EditorDialog({
  title,
  trigger,
  triggerLabel,
  id,
  children,
}: {
  title: string;
  trigger: ReactNode;
  triggerLabel?: string;
  id?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const editors = useContext(Editing);
  const complete = () => {
    setDiscarding(false);
    setOpen(false);
  };
  const cancel = () => {
    if (dialog.current?.querySelector("fieldset:disabled")) return;
    const dirty = [...(editors?.entries() || [])].some(
      ([form, editor]) => dialog.current?.contains(form) && editor.dirty(),
    );
    if (dirty) setDiscarding(true);
    else complete();
  };
  return (
    <>
      <button
        type="button"
        className="editor-trigger"
        aria-label={triggerLabel}
        title={triggerLabel}
        id={id}
        ref={button}
        onClick={() => setOpen(true)}
      >
        {trigger}
      </button>
      {open && (
        <Modal
          open
          onClose={cancel}
          title={title}
          closeLabel="Close editor"
          trigger={button}
          ref={dialog}
          className="editor-dialog"
        >
          <DialogActions.Provider value={{ cancel, complete }}>
            {children}
          </DialogActions.Provider>
          <ConfirmDialog
            open={discarding}
            title="Discard unsaved changes?"
            confirmLabel="Discard changes"
            cancelLabel="Keep editing"
            onConfirm={complete}
            onCancel={() => setDiscarding(false)}
          >
            <p>Your changes in “{title}” will not be saved.</p>
          </ConfirmDialog>
        </Modal>
      )}
    </>
  );
}
export function EditForm({
  trigger,
  triggerLabel,
  id,
  ...props
}: FormContentsProps & {
  trigger?: ReactNode;
  triggerLabel?: string;
}) {
  return trigger ? (
    <EditorDialog
      title={props.label}
      trigger={trigger}
      triggerLabel={triggerLabel}
      id={id}
    >
      <FormContents {...props} modal />
    </EditorDialog>
  ) : (
    <FormContents {...props} id={id} />
  );
}

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useBlocker, useFetcher, type FormProps } from "react-router";

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

export function EditForm({
  label,
  children,
  resetOnSave = false,
  ...props
}: FormProps & { label: string; resetOnSave?: boolean }) {
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
    }
    submitted.current = "";
    resolveSave.current?.(ok);
    resolveSave.current = null;
  }, [fetcher.state, fetcher.data, resetOnSave]);
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
}: {
  href: string;
  children: ReactNode;
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
        {children} <span aria-hidden="true">↗</span>
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

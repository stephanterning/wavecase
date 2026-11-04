import { Icon } from "./icons";
import { Modal } from "./modal";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Form, useSearchParams, type FormProps } from "react-router";

/** Opens from its button or a `?create=1` shortcut, which is then removed. */
export function CreateDialog({
  title,
  error,
  submit,
  children,
  ...props
}: Omit<FormProps, "method"> & {
  title: string;
  error?: string;
  submit: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [search, setSearch] = useSearchParams();
  const [open, setOpen] = useState(
    () => search.get("create") === "1" || !!error,
  );
  useEffect(() => {
    if (!search.has("create")) return;
    const next = new URLSearchParams(search);
    next.delete("create");
    setSearch(next, { replace: true, preventScrollReset: true });
  }, [search, setSearch]);
  return (
    <>
      <button ref={trigger} onClick={() => setOpen(true)}>
        <Icon name="plus" /> {title}
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        trigger={trigger}
      >
        <Form method="post" {...props}>
          {children}
          <div className="dialog-actions">
            <button
              type="button"
              className="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            {submit}
          </div>
          {error && <p role="alert">{error}</p>}
        </Form>
      </Modal>
    </>
  );
}

import { useEffect, useRef, type ComponentProps } from "react";

/** Native modal dialog that returns focus to whatever was focused when it opened. */
export function Modal({
  open,
  onClose,
  className,
  ...props
}: Omit<ComponentProps<"dialog">, "open" | "onClose" | "onCancel"> & {
  open: boolean;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const element = dialog.current!;
    if (open && !element.open) {
      opener.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      element.showModal();
    } else if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      {...props}
      ref={dialog}
      className={`comment-dialog${className ? ` ${className}` : ""}`}
      // React propagates cancel and close to dialogs further up the tree.
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        opener.current?.focus();
        opener.current = null;
      }}
    />
  );
}

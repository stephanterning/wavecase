import {
  useId,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from "react";
import { Icon } from "./icons";

/**
 * Native modal dialog with a heading and close icon. Escape and the icon call
 * `onClose`. Closing or unmounting returns focus to `trigger`, or else to
 * whatever was focused when it opened (Safari does not focus clicked buttons).
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  closeLabel = "Close dialog",
  trigger,
  ref,
  className,
  children,
  ...props
}: Omit<
  ComponentProps<"dialog">,
  "open" | "onClose" | "onCancel" | "title" | "ref"
> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  closeLabel?: string;
  trigger?: RefObject<HTMLElement | null>;
  ref?: RefObject<HTMLDialogElement | null>;
}) {
  const own = useRef<HTMLDialogElement>(null);
  const dialog = ref ?? own;
  const heading = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const opener =
      trigger?.current ??
      (document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null);
    element.showModal();
    return () => {
      // An enclosing modal closing at the same time has already moved focus.
      const restore =
        element.contains(document.activeElement) ||
        document.activeElement === document.body;
      // A nested modal left open would keep the opener inert.
      for (const nested of element.querySelectorAll("dialog[open]"))
        (nested as HTMLDialogElement).close();
      element.close();
      if (restore) opener?.focus({ preventScroll: true });
    };
  }, [open, trigger, dialog]);
  return (
    <dialog
      aria-labelledby={heading}
      {...props}
      ref={dialog}
      className={`modal${className ? ` ${className}` : ""}`}
      // React propagates cancel and close to dialogs further up the tree.
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClose={(event) => {
        event.stopPropagation();
        // Browsers may skip a prevented cancel and close directly; stay in sync.
        if (open && !event.currentTarget.open) {
          event.currentTarget.showModal();
          onClose();
        }
      }}
    >
      <div className="dialog-heading">
        <div>
          {eyebrow && <p className="eyebrow keep-case">{eyebrow}</p>}
          <h2 id={heading}>{title}</h2>
        </div>
        <button
          type="button"
          className="icon-action"
          aria-label={closeLabel}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { Modal } from "./modal";

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const heading = useId();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      className="confirm-dialog"
      aria-labelledby={heading}
    >
      <h2 id={heading}>{title}</h2>
      {children}
      <div className="dialog-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="button-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Asks before acting. Without `onConfirm`, confirming submits the button's
 * form with the button as submitter, so its name and value are sent.
 */
export function ConfirmButton({
  confirmTitle,
  confirmMessage,
  confirmLabel,
  onConfirm,
  ...props
}: Omit<ComponentProps<"button">, "onClick"> & {
  confirmTitle: string;
  confirmMessage: ReactNode;
  confirmLabel: string;
  onConfirm?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        {...props}
        ref={button}
        onClick={(event) => {
          event.preventDefault();
          setOpen(true);
        }}
      />
      <ConfirmDialog
        open={open}
        title={confirmTitle}
        confirmLabel={confirmLabel}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          if (onConfirm) onConfirm();
          else button.current?.form?.requestSubmit(button.current);
        }}
      >
        {confirmMessage}
      </ConfirmDialog>
    </>
  );
}

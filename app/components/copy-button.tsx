import type { ButtonHTMLAttributes } from "react";
import { Icon } from "./icons";

export function CopyButton({
  url,
  copiedMessage,
  onResult,
  ...props
}: Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "type"
> & {
  url: string;
  copiedMessage: string;
  onResult: (message: string) => void;
}) {
  return (
    <button
      {...props}
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(
            new URL(url, window.location.href).href,
          );
          onResult(copiedMessage);
        } catch {
          onResult("Could not copy the link. Please try again.");
        }
      }}
    >
      <Icon name="copy" />
    </button>
  );
}

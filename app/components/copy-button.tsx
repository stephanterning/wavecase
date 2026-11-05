import type { ComponentProps } from "react";
import { IconButton } from "./icon-button";

export function CopyButton({
  url,
  copiedMessage,
  onResult,
  ...props
}: Omit<ComponentProps<typeof IconButton>, "icon" | "onClick" | "type"> & {
  url: string;
  copiedMessage: string;
  onResult: (message: string) => void;
}) {
  return (
    <IconButton
      {...props}
      icon="copy"
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
    />
  );
}

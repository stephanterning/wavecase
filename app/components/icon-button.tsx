import type { ComponentProps, ReactElement } from "react";
import { Icon, type IconName } from "./icons";

/**
 * A button without visible text. `label` is its accessible name and, unless
 * `tooltip` differs, the tooltip shown on hover and keyboard focus. Name the
 * object it acts on, e.g. "Delete link: Mixing team", not just "Delete".
 */
export function IconButton({
  icon,
  label,
  tooltip = label,
  className,
  ...props
}: Omit<ComponentProps<"button">, "children" | "aria-label" | "title"> & {
  icon: IconName | ReactElement;
  label: string;
  tooltip?: string;
}) {
  return (
    <button
      type="button"
      {...props}
      className={className ? `${className} tooltip` : "tooltip"}
      aria-label={label}
      data-tooltip={tooltip}
    >
      {typeof icon === "string" ? <Icon name={icon} /> : icon}
    </button>
  );
}

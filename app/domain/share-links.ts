export function visibleThroughLink(
  version: { position: number; state: string },
  link: { fromOrder: number | null; pinnedOrder: number | null },
) {
  return (
    (version.state === "ready" || version.state === "missing") &&
    (link.fromOrder === null || version.position >= link.fromOrder) &&
    (link.pinnedOrder === null || version.position === link.pinnedOrder)
  );
}

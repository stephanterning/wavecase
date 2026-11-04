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

export function linkVersionScope(
  link: { fromOrder: number | null; pinnedOrder: number | null },
  versions: { name: string; position?: number }[],
) {
  const name = (order: number) =>
    versions.find((v) => v.position === order)?.name || "deleted version";
  return link.pinnedOrder != null
    ? `Only ${name(link.pinnedOrder)}`
    : link.fromOrder != null
      ? `From ${name(link.fromOrder)} onward`
      : "All versions";
}

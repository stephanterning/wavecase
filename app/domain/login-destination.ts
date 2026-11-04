// Post-login destinations are limited to workspace pages and artist invitations.
export function loginDestination(value: unknown) {
  return typeof value === "string" &&
    (/^\/artist-invitations\/[A-Za-z0-9_-]{43}$/.test(value) ||
      /^\/(dashboard|library|releases|artist-profiles|account|admin|tracks)(\/[A-Za-z0-9_-]+)*$/.test(
        value,
      ))
    ? value
    : "/dashboard";
}

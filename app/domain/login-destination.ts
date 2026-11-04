// Only the artist invitation flow can request a post-login destination.
export function loginDestination(value: unknown) {
  return typeof value === "string" &&
    /^\/artist-invitations\/[A-Za-z0-9_-]{43}$/.test(value)
    ? value
    : "/dashboard";
}

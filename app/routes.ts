import { index, route, type RouteConfig } from "@react-router/dev/routes";
export default [
  route("health", "routes/health.ts"),
  route("cover/:id", "routes/cover.ts"),
  route("account", "routes/account.tsx"),
  route("tracks/:id/manage", "routes/manage.ts"),
  route("events/:id", "routes/events.ts"),
  route("visits/:share", "routes/visits.ts"),
  route("tracks/:id/analytics", "routes/analytics.tsx"),
  route("admin", "routes/admin.tsx"),
  route("logout", "routes/logout.ts"),
  index("routes/home.tsx"),
  route("auth/:action", "routes/auth.ts"),
  route("library", "routes/library.tsx"),
  route("tracks/:id", "routes/track.tsx"),
  route("s/:share", "routes/share.tsx"),
  route("media/:id", "routes/media.ts"),
  route("feedback/:id", "routes/feedback.ts"),
] satisfies RouteConfig;

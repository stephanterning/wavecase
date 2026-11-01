export function isPreview(request: Request) {
  return new URL(request.url).searchParams.get("preview") === "1";
}
export function ownerPreview(request: Request, owner: boolean) {
  if (!isPreview(request)) return false;
  if (!owner) throw new Response("Preview not found", { status: 404 });
  return true;
}
export function rejectPreviewMutation(request: Request) {
  if (isPreview(request))
    throw new Response("Preview only. Nothing was submitted.", { status: 403 });
}

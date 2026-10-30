/** A readable, single path component that is safe to extract on common filesystems. */
export function downloadName(value: string) {
  const cleaned = value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  let name = "";
  // Leave room for extensions while respecting UTF-8 filesystem byte limits.
  for (const character of cleaned) {
    if (Buffer.byteLength(name + character, "utf8") > 200) break;
    name += character;
  }
  name = name.replace(/[. ]+$/g, "") || "Download";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name))
    name = "_" + name;
  return name;
}

export function zipDisposition(name: string) {
  // RFC 5987 preserves Unicode names; older clients receive a readable ASCII fallback.
  const fallback = name.replace(/[^\x20-\x7e]/g, "_");
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  return `attachment; filename="${fallback}.zip"; filename*=UTF-8''${encoded}.zip`;
}

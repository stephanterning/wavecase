export function commentTime(seconds: number) {
  const rounded = Math.round(seconds * 100);
  const minutes = Math.floor(rounded / 6000);
  const remainder = (rounded % 6000) / 100;
  return `${minutes}:${remainder.toFixed(2).padStart(5, "0").replace(/\.00$/, "")}`;
}
export function parseCommentTime(value: string) {
  if (!/^\d+:[0-5]\d(?:\.\d{1,2})?$/.test(value)) return NaN;
  const [minutes, seconds] = value.split(":").map(Number);
  return minutes * 60 + seconds;
}

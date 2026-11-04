// Parts are assembled by hand so server and browser render identical text.
const dateParts = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});
function parts(value: Date | string | number) {
  return Object.fromEntries(
    dateParts
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
}
export function formatDate(value: Date | string | number) {
  const p = parts(value);
  return `${p.day} ${p.month} ${p.year}`;
}
export function formatDateTime(
  value: Date | string | number,
  { seconds = false } = {},
) {
  const p = parts(value);
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute}${seconds ? ":" + p.second : ""} UTC`;
}
export function formatClock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
const pluralRules = new Intl.PluralRules("en");
export function formatCount(
  count: number,
  singular: string,
  plural = singular + "s",
) {
  return `${count} ${pluralRules.select(count) === "one" ? singular : plural}`;
}

// Typed delete confirmations ignore the dash, quote and space variants that
// keyboards and smart punctuation substitute; letters and case must still match.
const normalize = (value: string) =>
  value
    .normalize("NFKC")
    .replace(/[\p{Pd}\u2212]/gu, "-")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

export function matchesConfirmation(typed: string, expected: string) {
  return normalize(typed) === normalize(expected);
}

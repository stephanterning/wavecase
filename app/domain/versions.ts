export const versionStatuses = [
  "early idea",
  "work in progress",
  "to finish",
  "finished",
] as const;

export const defaultVersionStatus = "early idea";

export function versionNameFromFile(filename: string) {
  return filename.match(/(?:^|[ _-])(v\d+(?:\.\d+)*)/i)?.[1];
}

export function nextVersionName(names: string[]) {
  const numbers = names.map((name) => Number(/^v(\d+)/i.exec(name)?.[1] || 0));
  return `v${Math.max(0, ...numbers) + 1}`;
}

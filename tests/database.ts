export const enabled =
  process.env.DATABASE_URL?.endsWith("/wavecase_test") ?? false;

if (process.env.CI && !enabled) {
  throw new Error(
    "Database tests must not be skipped in CI: DATABASE_URL must end in /wavecase_test.",
  );
}

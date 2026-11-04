export const dataDir = () => process.env.DATA_DIR || "data/audio";
export const maxUploadBytes = () =>
  Number(process.env.MAX_UPLOAD_MB || 256) * 1024 * 1024;
export const appUrl = () => process.env.APP_URL || "http://localhost:5173";
export function requireProductionConfig() {
  if (process.env.NODE_ENV === "production" && !process.env.APP_URL)
    throw new Error(
      "APP_URL is required in production. Set it to the exact browser origin, such as https://music.example.com.",
    );
}

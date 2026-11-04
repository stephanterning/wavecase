import { execFile } from "node:child_process";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// Holds ffmpeg runs started by this process until released, so a test can act
// while an export is encoding. Release also when a test fails.
export async function holdFfmpeg() {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-ffmpeg-"));
  const { stdout } = await promisify(execFile)("sh", [
    "-c",
    "command -v ffmpeg",
  ]);
  await writeFile(
    join(directory, "ffmpeg"),
    `#!/bin/sh
touch '${directory}/started' 2>/dev/null
while [ -d '${directory}' ]; do sleep 0.02; done
exec '${stdout.trim()}' "$@"
`,
    { mode: 0o755 },
  );
  const path = process.env.PATH;
  process.env.PATH = `${directory}:${path}`;
  return {
    async started() {
      for (let attempt = 0; attempt < 500; attempt++) {
        if (await stat(join(directory, "started")).catch(() => null)) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error("ffmpeg was not started");
    },
    async release() {
      process.env.PATH = path;
      await rm(directory, { recursive: true, force: true });
    },
  };
}

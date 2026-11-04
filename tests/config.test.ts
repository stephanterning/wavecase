import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("the production web server refuses to start without APP_URL", async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    PORT: "0",
  };
  delete env.APP_URL;
  const error = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "scripts/serve.ts"],
    { env, timeout: 20000 },
  ).then(
    () => assert.fail("The server started without APP_URL"),
    (error: { code?: number; stderr?: string }) => error,
  );
  assert.equal(error.code, 1);
  assert.match(error.stderr ?? "", /APP_URL is required in production/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { RouterContextProvider } from "react-router";
import { loader } from "../app/routes/workspace";
import { loginDestination } from "../app/domain/login-destination";
import { origin } from "../app/server/security";

async function signedOutVisit(path: string, dataPath = path) {
  const request = new Request(origin + dataPath);
  const thrown = await loader({
    request,
    params: {},
    url: new URL(origin + path),
    pattern: "/",
    context: new RouterContextProvider(),
  }).catch((error: unknown) => error);
  assert.ok(thrown instanceof Response);
  assert.equal(thrown.status, 302);
  return thrown.headers.get("location");
}

test("signed-out workspace visits redirect to sign-in and return to the page", async () => {
  assert.equal(await signedOutVisit("/dashboard"), "/");
  for (const path of [
    "/library",
    "/account",
    "/admin",
    "/tracks/0b4ee2b4-7cf0-4c79-9f62-1d3e8c9a8d10",
    "/tracks/0b4ee2b4-7cf0-4c79-9f62-1d3e8c9a8d10/analytics",
  ])
    assert.equal(
      await signedOutVisit(path),
      "/?returnTo=" + encodeURIComponent(path),
    );
  assert.equal(
    await signedOutVisit("/library", "/library.data"),
    "/?returnTo=%2Flibrary",
  );
});

test("login destinations stay on workspace pages and invitations", () => {
  assert.equal(loginDestination("/releases/abc-123"), "/releases/abc-123");
  for (const invalid of [
    "/",
    "/logout",
    "/s/share-token",
    "/library/../logout",
    "/library?create=1",
    "/tracks//attacker.invalid",
    "/dashboardx",
  ])
    assert.equal(loginDestination(invalid), "/dashboard");
});

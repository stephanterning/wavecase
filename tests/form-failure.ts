import assert from "node:assert/strict";

export function formFailure(result: unknown) {
  assert.ok(
    result && typeof result === "object" && "init" in result,
    "expected a form error response",
  );
  const { data, init } = result as {
    data: { error?: string };
    init: ResponseInit | null;
  };
  return { status: init?.status, error: data.error };
}

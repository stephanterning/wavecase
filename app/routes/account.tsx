import { Form, useLoaderData, useRevalidator } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../server/db";
import { passkeys } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    user,
    keys: await db
      .select({ id: passkeys.id })
      .from(passkeys)
      .where(eq(passkeys.userId, user.id)),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const form = await request.formData();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id=${user.id} for update`);
    const keys = await tx.query.passkeys.findMany({
      where: eq(passkeys.userId, user.id),
    });
    if (keys.length <= 1)
      throw new Response("Keep at least one passkey on your account", {
        status: 400,
      });
    await tx
      .delete(passkeys)
      .where(
        and(
          eq(passkeys.id, String(form.get("id"))),
          eq(passkeys.userId, user.id),
        ),
      );
  });
  return { ok: true };
}
export default function Account() {
  const { user, keys } = useLoaderData<typeof loader>();
  const [error, setError] = useState("");
  const revalidator = useRevalidator();
  async function add() {
    try {
      const response = await fetch("/auth/register-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: user.name, email: user.email }),
      });
      if (!response.ok) throw new Error("Could not start passkey registration");
      const credential = await startRegistration({
        optionsJSON: await response.json(),
      });
      const verified = await fetch("/auth/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credential),
      });
      if (!verified.ok) throw new Error("Could not save passkey");
      await revalidator.revalidate();
    } catch (e) {
      setError(String(e));
    }
  }
  return (
    <>
      <a href="/library">← Your library</a>
      <h1>Your account</h1>
      <p>
        {user.name} · {user.email}
      </p>
      <section className="panel">
        <h2>Passkeys</h2>
        {keys.map((key, i) => (
          <Form method="post" key={key.id}>
            <input type="hidden" name="id" value={key.id} />
            <p>
              Passkey {i + 1} · {key.id.slice(0, 8)}{" "}
              <button disabled={keys.length <= 1}>Remove</button>
            </p>
          </Form>
        ))}
        <button onClick={() => void add()}>Add passkey</button>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}

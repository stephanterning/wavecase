import {
  Form,
  useActionData,
  useLoaderData,
  useNavigation,
  useRevalidator,
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../server/db";
import { passkeys, users } from "../server/schema";
import { requireUser, sameOrigin } from "../server/security";
import { accountDetails } from "../server/auth";
import { ConfirmButton } from "../components/confirm-dialog";
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await requireUser(request);
  return {
    user,
    keys: await db
      .select({
        id: passkeys.id,
        createdAt: passkeys.createdAt,
        lastUsedAt: passkeys.lastUsedAt,
      })
      .from(passkeys)
      .where(eq(passkeys.userId, user.id))
      .orderBy(sql`${passkeys.createdAt} asc nulls first`, passkeys.id),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await requireUser(request);
  const form = await request.formData();
  if (form.get("intent") === "details") {
    const details = accountDetails.safeParse({
      name: form.get("name"),
      email: form.get("email"),
    });
    if (!details.success)
      return {
        saved: false,
        error: details.error.issues.map((i) => i.message).join(" "),
      };
    try {
      await db.update(users).set(details.data).where(eq(users.id, user.id));
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505")
        return {
          saved: false,
          error: "Another account already uses this email address.",
        };
      throw error;
    }
    return { saved: true, error: undefined };
  }
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
  return { saved: false, error: undefined };
}
const day = (value: Date) =>
  new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
function passkeyDates(key: {
  createdAt: Date | null;
  lastUsedAt: Date | null;
}) {
  const added = key.createdAt
    ? "Added " + day(key.createdAt)
    : "Date added unknown";
  const used = key.lastUsedAt
    ? "Last used " + day(key.lastUsedAt)
    : key.createdAt
      ? "Not used to sign in yet"
      : "Last use unknown";
  return `${added} · ${used}`;
}
export default function Account() {
  const { user, keys } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
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
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <>
      <h1>Your account</h1>
      <Form
        method="post"
        className="panel settings-panel"
        key={user.name + "\n" + user.email}
      >
        <h2>Profile</h2>
        <input type="hidden" name="intent" value="details" />
        <label>
          Display name
          <input
            name="name"
            defaultValue={user.name}
            required
            maxLength={100}
            autoComplete="name"
          />
        </label>
        <p className="muted">Shown on new comments you write.</p>
        <label>
          Email
          <input
            name="email"
            type="email"
            defaultValue={user.email}
            required
            maxLength={254}
            autoComplete="email"
          />
        </label>
        <button
          className="button-primary"
          disabled={navigation.state !== "idle"}
        >
          Save profile
        </button>
        {result?.saved && navigation.state === "idle" && (
          <p role="status">Profile saved.</p>
        )}
        {result?.error && <p role="alert">{result.error}</p>}
      </Form>
      <section className="panel settings-panel">
        <h2>Passkeys</h2>
        {keys.map((key, i) => (
          <Form method="post" key={key.id}>
            <input type="hidden" name="id" value={key.id} />
            <p>
              Passkey {i + 1} · {key.id.slice(0, 8)}
              <br />
              <span className="muted">{passkeyDates(key)}</span>
            </p>
            <ConfirmButton
              disabled={keys.length <= 1}
              confirmTitle={`Remove passkey ${i + 1} · ${key.id.slice(0, 8)}?`}
              confirmMessage={
                <>
                  <p className="muted">{passkeyDates(key)}</p>
                  <p>
                    You will no longer be able to sign in with this passkey.
                    Make sure you can sign in with one of your other passkeys
                    first. This cannot be undone.
                  </p>
                </>
              }
              confirmLabel="Remove passkey"
            >
              Remove
            </ConfirmButton>
          </Form>
        ))}
        {keys.length <= 1 && (
          <p className="muted">
            Keep at least one passkey so you can sign in. Add another before
            removing this one.
          </p>
        )}
        <button onClick={() => void add()}>Add passkey</button>
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}

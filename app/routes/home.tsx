import { useState } from "react";
import { useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { db } from "../server/db";
import { viewer } from "../server/security";
export async function loader({ request }: LoaderFunctionArgs) {
  if (await viewer(request)) return redirect("/library");
  const settings = await db.query.settings.findFirst();
  return {
    setup: !settings,
    recovery: new URL(request.url).searchParams.get("recovery") || undefined,
    open: settings?.openRegistration || false,
    invitation:
      new URL(request.url).searchParams.get("invitation") || undefined,
  };
}
async function post(path: string, body: unknown) {
  const response = await fetch("/auth/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text.startsWith("{") ? JSON.parse(text).error : text);
  }
  return response.json();
}
export default function Home() {
  const data = useLoaderData<typeof loader>();
  const [register, setRegister] = useState(
    data.setup || !!data.invitation || !!data.recovery,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (register) {
        const options = await post("register-options", {
          name: form.get("name"),
          email: form.get("email"),
          open: form.get("open") === "on",
          invitation: data.invitation,
          recovery: data.recovery,
        });
        await post(
          "register-verify",
          await startRegistration({ optionsJSON: options }),
        );
      } else {
        const options = await post("login-options", {});
        await post(
          "login-verify",
          await startAuthentication({ optionsJSON: options }),
        );
      }
      window.location.assign("/library");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="welcome">
      <p className="eyebrow">PRIVATE MUSIC SHARING</p>
      <h1>
        {data.setup
          ? "Make room for your music."
          : register
            ? "Your next idea starts here."
            : "Welcome back."}
      </h1>
      <p className="muted">
        {data.setup
          ? "Create the first administrator account to set up Wavecase."
          : "Share your progress. Hear what matters."}
      </p>
      <form onSubmit={submit} className="panel">
        {register && (
          <>
            <label>
              Display name
              <input name="name" required maxLength={100} autoComplete="name" />
            </label>
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
            {data.setup && (
              <label className="check">
                <input type="checkbox" name="open" />
                Allow open registration
              </label>
            )}
          </>
        )}
        <button disabled={busy}>
          {busy
            ? "Waiting for your passkey…"
            : register
              ? data.recovery
                ? "Replace lost passkeys"
                : "Create account with passkey"
              : "Sign in with passkey"}
        </button>
        {error && <p role="alert">{error}</p>}
        <p className="muted">
          Use Face ID, Touch ID, or a security key. No password needed.
        </p>
      </form>
      {!data.setup && (data.open || data.invitation) && (
        <button className="secondary" onClick={() => setRegister(!register)}>
          {register ? "Already have an account? Sign in" : "Create an account"}
        </button>
      )}
    </section>
  );
}

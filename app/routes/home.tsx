import { loginDestination } from "../domain/login-destination";
import { useState } from "react";
import { useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import {
  startRegistration,
  startAuthentication,
} from "@simplewebauthn/browser";
import { db } from "../server/db";
import { viewer } from "../server/security";
import { recoveryAccount, validInvitation } from "../server/auth";
export async function loader({ request }: LoaderFunctionArgs) {
  const params = new URL(request.url).searchParams;
  const returnTo = loginDestination(params.get("returnTo"));
  if (await viewer(request)) return redirect(returnTo);
  const settings = await db.query.settings.findFirst();
  const invitation = params.get("invitation");
  const recovery = params.get("recovery");
  const account = recovery && (await recoveryAccount(recovery));
  const valid = !!invitation && (await validInvitation(invitation));
  return {
    returnTo,
    setup: !settings,
    open: settings?.openRegistration || false,
    invitation: (valid && invitation) || undefined,
    invitationUnavailable: !!invitation && !valid,
    recovery: recovery
      ? {
          id: recovery,
          account: account && { name: account.name, email: account.email },
        }
      : undefined,
    artistInvitation: returnTo.startsWith("/artist-invitations/"),
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
    throw Object.assign(
      new Error(text.startsWith("{") ? JSON.parse(text).error : text),
      { status: response.status },
    );
  }
  return response.json();
}
function forgetPasskey(rpId: string, credentialId: string) {
  if ("signalUnknownCredential" in PublicKeyCredential)
    PublicKeyCredential.signalUnknownCredential({ rpId, credentialId }).catch(
      () => {},
    );
}
export default function Home() {
  const data = useLoaderData<typeof loader>();
  const account = data.recovery?.account;
  const [register, setRegister] = useState(data.setup || !!data.invitation);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      if (account || register) {
        const options = await post(
          "register-options",
          account
            ? { recovery: data.recovery!.id }
            : {
                name: form.get("name"),
                email: form.get("email"),
                open: form.get("open") === "on",
                invitation: data.invitation,
              },
        );
        await post(
          "register-verify",
          await startRegistration({ optionsJSON: options }),
        );
      } else {
        const options = await post("login-options", {});
        const credential = await startAuthentication({ optionsJSON: options });
        await post("login-verify", credential).catch((e) => {
          if (e.status === 404) forgetPasskey(options.rpId, credential.id);
          throw e;
        });
      }
      window.location.assign(data.returnTo);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  if (account)
    return (
      <section className="welcome">
        <p className="eyebrow">ACCOUNT RECOVERY</p>
        <h1>Recover your account.</h1>
        <form onSubmit={submit} className="panel">
          <p>
            <strong>{account.name}</strong>
            <br />
            {account.email}
          </p>
          <p className="muted">
            Create a new passkey for this account. It replaces all of the
            account's existing passkeys and ends all of its existing sessions.
          </p>
          <button className="button-primary" disabled={busy}>
            {busy ? "Waiting for your passkey…" : "Replace passkeys"}
          </button>
          {error && <p role="alert">{error}</p>}
        </form>
      </section>
    );
  const notice = data.recovery
    ? "This recovery link has expired or has already been used. Ask an administrator for a new one."
    : data.invitationUnavailable
      ? "This account invitation has expired, been used or been revoked. Ask an administrator for a new one."
      : data.invitation && register
        ? "Your invitation is valid. Create your account below."
        : data.artistInvitation && !register
          ? data.open
            ? "Sign in to review your artist invitation. If you don't have an account yet, create one first; you will return to the invitation afterwards."
            : "Sign in to review your artist invitation. To accept it you need a Wavecase account, and new accounts on this server require an account invitation from an administrator."
          : "";
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
      {notice && <p role="status">{notice}</p>}
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
        <button className="button-primary" disabled={busy}>
          {busy
            ? "Waiting for your passkey…"
            : register
              ? "Create account with passkey"
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

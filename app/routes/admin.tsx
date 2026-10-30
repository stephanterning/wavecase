import { Form, useLoaderData, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { invitations, settings, users, recoveries } from "../server/schema";
import {
  hash,
  origin,
  requireUser,
  sameOrigin,
  token,
} from "../server/security";
async function admin(request: Request) {
  const user = await requireUser(request);
  if (!user.admin) throw new Response("Forbidden", { status: 403 });
  return user;
}
export async function loader({ request }: LoaderFunctionArgs) {
  const user = await admin(request);
  return {
    user,
    settings: await db.query.settings.findFirst(),
    users: await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        disabled: users.disabled,
      })
      .from(users),
    invitations: await db.select().from(invitations),
  };
}
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const user = await admin(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "recover") {
    const target = await db.query.users.findFirst({
      where: eq(users.id, String(form.get("id"))),
    });
    if (!target || target.admin || target.disabled)
      throw new Response("This account must be recovered from the server", {
        status: 403,
      });
    const value = token();
    await db.insert(recoveries).values({
      id: hash(value),
      userId: target.id,
      expires: new Date(Date.now() + 15 * 60000),
    });
    return { invitation: origin + "/?recovery=" + value };
  }
  if (intent === "settings")
    await db
      .update(settings)
      .set({ openRegistration: form.has("open") })
      .where(eq(settings.id, 1));
  else if (intent === "invite") {
    const value = token();
    await db.insert(invitations).values({
      id: hash(value),
      expires: new Date(Date.now() + 7 * 86400000),
    });
    return { invitation: origin + "/?invitation=" + value };
  } else if (intent === "revoke")
    await db
      .delete(invitations)
      .where(eq(invitations.id, String(form.get("id"))));
  else if (intent === "disable") {
    const id = String(form.get("id"));
    if (id === user.id)
      throw new Response("You cannot disable your own account", {
        status: 400,
      });
    await db
      .update(users)
      .set({ disabled: form.get("disabled") === "true" })
      .where(eq(users.id, id));
  }
  return { invitation: null };
}
export default function Admin() {
  const data = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  return (
    <>
      <a href="/library">← Your library</a>
      <h1>Installation settings</h1>
      <Form method="post" className="panel">
        <input type="hidden" name="intent" value="settings" />
        <label className="check">
          <input
            type="checkbox"
            name="open"
            defaultChecked={data.settings?.openRegistration}
          />
          Allow open registration
        </label>
        <button>Save settings</button>
      </Form>
      <section className="panel">
        <h2>Invitations</h2>
        <Form method="post">
          <button name="intent" value="invite">
            Create invitation
          </button>
        </Form>
        {result?.invitation && (
          <p>
            <a href={result.invitation}>{result.invitation}</a>
          </p>
        )}
        {data.invitations.map((invite) => (
          <Form key={invite.id} method="post">
            <input type="hidden" name="id" value={invite.id} />
            <p>
              {invite.used
                ? "Used"
                : "Expires " +
                  new Date(invite.expires).toLocaleDateString("en-GB", {
                    timeZone: "UTC",
                  })}{" "}
              <button name="intent" value="revoke">
                Revoke
              </button>
            </p>
          </Form>
        ))}
      </section>
      <section className="panel">
        <h2>Accounts</h2>
        {data.users.map((user) => (
          <Form method="post" key={user.id}>
            <input type="hidden" name="id" value={user.id} />
            {user.id !== data.user.id && !user.disabled && (
              <button name="intent" value="recover">
                Create recovery link
              </button>
            )}
            <input
              type="hidden"
              name="disabled"
              value={String(!user.disabled)}
            />
            <p>
              {user.name} · {user.email}{" "}
              {user.id !== data.user.id && (
                <button name="intent" value="disable">
                  {user.disabled ? "Enable" : "Disable"}
                </button>
              )}
            </p>
          </Form>
        ))}
      </section>
    </>
  );
}

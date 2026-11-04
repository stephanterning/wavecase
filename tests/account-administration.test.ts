import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import { passkeys, recoveries, sessions, users } from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { action as admin } from "../app/routes/admin";
import { action as account } from "../app/routes/account";
import { enabled } from "./database";
after(() => pool.end());

const args = (request: Request) => ({
  request,
  params: {},
  url: new URL(request.url),
  pattern: "/",
  context: new RouterContextProvider(),
});
const post = (path: string, cookie: string, values: Record<string, string>) =>
  new Request(origin + path, {
    method: "POST",
    headers: { origin, cookie },
    body: new URLSearchParams(values),
  });
async function rejection(result: Promise<unknown>) {
  const thrown = await result.then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(thrown instanceof Response);
  return thrown.status;
}
async function signedIn(isAdmin = false) {
  const id = randomUUID(),
    session = randomUUID();
  await db.insert(users).values({
    id,
    name: "Account " + id,
    email: id + "@test.invalid",
    admin: isAdmin,
  });
  await db.insert(sessions).values({
    id: hash(session),
    userId: id,
    expires: new Date(Date.now() + 60000),
  });
  return { id, cookie: "session=" + session };
}

test(
  "installation actions are forbidden for non-administrators",
  { skip: !enabled },
  async () => {
    const user = await signedIn();
    const other = await signedIn();
    for (const intent of ["settings", "invite", "revoke", "recover", "disable"])
      assert.equal(
        await rejection(
          admin(args(post("/admin", user.cookie, { intent, id: other.id }))),
        ),
        403,
        intent,
      );
    assert.equal(
      (await db.query.users.findFirst({ where: eq(users.id, other.id) }))
        ?.disabled,
      false,
    );
    assert.equal(
      (
        await db.query.recoveries.findMany({
          where: eq(recoveries.userId, other.id),
        })
      ).length,
      0,
    );
  },
);

test(
  "installation actions reject malformed account ids and oversized forms",
  { skip: !enabled },
  async () => {
    const administrator = await signedIn(true);
    for (const intent of ["recover", "disable"])
      assert.equal(
        await rejection(
          admin(
            args(
              post("/admin", administrator.cookie, {
                intent,
                id: "not-a-uuid",
              }),
            ),
          ),
        ),
        400,
        intent,
      );
    assert.equal(
      await rejection(
        admin(
          args(
            post("/admin", administrator.cookie, {
              intent: "invite",
              padding: "x".repeat(5000),
            }),
          ),
        ),
      ),
      413,
    );
  },
);

test(
  "recovery links are only issued for non-administrator accounts",
  { skip: !enabled },
  async () => {
    const administrator = await signedIn(true);
    const otherAdministrator = await signedIn(true);
    const member = await signedIn();
    assert.equal(
      await rejection(
        admin(
          args(
            post("/admin", administrator.cookie, {
              intent: "recover",
              id: otherAdministrator.id,
            }),
          ),
        ),
      ),
      403,
    );
    const result = await admin(
      args(
        post("/admin", administrator.cookie, {
          intent: "recover",
          id: member.id,
        }),
      ),
    );
    const value = new URL(result.invitation!).searchParams.get("recovery")!;
    const recovery = await db.query.recoveries.findFirst({
      where: eq(recoveries.id, hash(value)),
    });
    assert.equal(recovery?.userId, member.id);
    assert.equal(
      (
        await db.query.recoveries.findMany({
          where: eq(recoveries.userId, otherAdministrator.id),
        })
      ).length,
      0,
    );
  },
);

test(
  "the last passkey cannot be removed and other accounts' passkeys are untouched",
  { skip: !enabled },
  async () => {
    const user = await signedIn();
    const other = await signedIn();
    const key = (userId: string) => ({
      id: randomUUID(),
      userId,
      publicKey: "test",
      counter: 0,
    });
    const [first, second, foreign] = [
      key(user.id),
      key(user.id),
      key(other.id),
    ];
    await db.insert(passkeys).values([first, second, foreign]);
    const remove = (id: string) =>
      account(args(post("/account", user.cookie, { id })));
    await remove(foreign.id);
    await remove(first.id);
    assert.equal(await rejection(remove(second.id)), 400);
    assert.deepEqual(
      (
        await db.query.passkeys.findMany({
          where: eq(passkeys.userId, user.id),
        })
      ).map((passkey) => passkey.id),
      [second.id],
    );
    assert.ok(
      await db.query.passkeys.findFirst({
        where: eq(passkeys.id, foreign.id),
      }),
    );
  },
);

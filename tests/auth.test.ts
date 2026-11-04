import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSync,
  randomBytes,
  createHash,
  randomUUID,
  sign,
} from "node:crypto";
import { encodeCBOR } from "@levischuck/tiny-cbor";
import { RouterContextProvider } from "react-router";
import { auth } from "../app/server/auth";
import { eq } from "drizzle-orm";
import { db, pool } from "../app/server/db";
import {
  invitations,
  passkeys,
  recoveries,
  sessions,
  settings,
  users,
} from "../app/server/schema";
import { hash, origin, rpID, viewer } from "../app/server/security";
import { enabled } from "./database";
after(() => pool.end());
function post(action: string, body: unknown, cookie = "") {
  return auth(
    new Request(origin + "/auth/" + action, {
      method: "POST",
      headers: { origin, cookie, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    action,
  );
}
function credential(challenge: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const jwk = publicKey.export({ format: "jwk" });
  const id = randomBytes(32);
  const cose = new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, Buffer.from(jwk.x!, "base64url")],
    [-3, Buffer.from(jwk.y!, "base64url")],
  ]);
  const data = Buffer.concat([
    createHash("sha256").update(rpID).digest(),
    Buffer.from([0x45]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([0, 32]),
    id,
    encodeCBOR(cose),
  ]);
  const client = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge, origin }),
  );
  const attestation = encodeCBOR(
    new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", data],
    ]) as Parameters<typeof encodeCBOR>[0],
  );
  return {
    privateKey,
    id: id.toString("base64url"),
    response: {
      id: id.toString("base64url"),
      rawId: id.toString("base64url"),
      type: "public-key",
      response: {
        clientDataJSON: client.toString("base64url"),
        attestationObject: Buffer.from(attestation).toString("base64url"),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    },
  };
}
const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0];
test(
  "real signed passkey registration/login, atomic setup and single-use invitations",
  { skip: !enabled },
  async () => {
    await db.delete(settings);
    const identity = {
      name: "Test owner",
      email: randomBytes(8).toString("hex") + "@test.invalid",
    };
    const a = await post("register-options", identity);
    const b = await post("register-options", {
      ...identity,
      email: "b" + identity.email,
    });
    let first = credential((await a.json()).challenge);
    const other = credential((await b.json()).challenge);
    const setup = await Promise.allSettled([
      post("register-verify", first.response, cookieOf(a)),
      post("register-verify", other.response, cookieOf(b)),
    ]);
    assert.equal(setup.filter((r) => r.status === "fulfilled").length, 1);
    const rejected = setup.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    assert.equal(rejected.reason.status, 409);
    if (setup[1].status === "fulfilled") {
      first = other;
      identity.email = "b" + identity.email;
    }
    await assert.rejects(post("register-verify", first.response, cookieOf(a)));
    const options = await post("login-options", {});
    const challenge = (await options.json()).challenge;
    const client = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin }),
    );
    const data = Buffer.concat([
      createHash("sha256").update(rpID).digest(),
      Buffer.from([0x05]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const signature = sign(
      "sha256",
      Buffer.concat([data, createHash("sha256").update(client).digest()]),
      first.privateKey,
    );
    const login = await post(
      "login-verify",
      {
        id: first.id,
        rawId: first.id,
        type: "public-key",
        response: {
          clientDataJSON: client.toString("base64url"),
          authenticatorData: data.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      },
      cookieOf(options),
    );
    assert.equal(
      (
        await viewer(
          new Request(origin, { headers: { cookie: cookieOf(login) } }),
        )
      )?.email,
      identity.email,
    );
    const used = await db.query.passkeys.findFirst({
      where: eq(passkeys.id, first.id),
    });
    assert.ok(used?.createdAt && used.lastUsedAt);
    assert.ok(used.lastUsedAt >= used.createdAt);
    const unknownOptions = await post("login-options", {});
    await assert.rejects(
      post(
        "login-verify",
        { id: randomBytes(32).toString("base64url") },
        cookieOf(unknownOptions),
      ),
      (error) => error instanceof Response && error.status === 404,
    );
    const invitation = randomBytes(32).toString("base64url");
    await db
      .insert(invitations)
      .values({ id: hash(invitation), expires: new Date(Date.now() + 60000) });
    const invited = await post("register-options", {
      name: "Invited",
      email: "c" + identity.email,
      invitation,
    });
    const invitedCredential = credential((await invited.json()).challenge);
    await post(
      "register-verify",
      invitedCredential.response,
      cookieOf(invited),
    );
    await assert.rejects(
      post("register-options", {
        name: "Again",
        email: "d" + identity.email,
        invitation,
      }),
    );
    await db
      .update(settings)
      .set({ openRegistration: true })
      .where(eq(settings.id, 1));
    const openInvite = randomBytes(32).toString("base64url");
    await db
      .insert(invitations)
      .values({ id: hash(openInvite), expires: new Date(Date.now() + 60000) });
    const enroll = {
      name: "Open invitation",
      email: "open" + identity.email,
      invitation: openInvite,
    };
    const invalid = await post("register-options", enroll);
    const invalidCredential = credential("incorrect-challenge");
    await assert.rejects(
      post("register-verify", invalidCredential.response, cookieOf(invalid)),
    );
    assert.equal(
      (await db.query.invitations.findFirst({
        where: eq(invitations.id, hash(openInvite)),
      }))!.used,
      false,
    );
    const openOptions = await post("register-options", enroll);
    await post(
      "register-verify",
      credential((await openOptions.json()).challenge).response,
      cookieOf(openOptions),
    );
    assert.equal(
      (await db.query.invitations.findFirst({
        where: eq(invitations.id, hash(openInvite)),
      }))!.used,
      true,
    );
    await assert.rejects(
      post("register-options", { ...enroll, email: "again" + identity.email }),
    );
    const expired = randomBytes(32).toString("base64url");
    await db
      .insert(invitations)
      .values({ id: hash(expired), expires: new Date(Date.now() - 1000) });
    await assert.rejects(
      post("register-options", { ...enroll, invitation: expired }),
    );
    await db.delete(invitations).where(eq(invitations.id, hash(expired)));
    await assert.rejects(
      post("register-options", { ...enroll, invitation: expired }),
    );
  },
);
const home = async (query: string) => {
  const { loader } = await import("../app/routes/home");
  const request = new Request(origin + "/?" + query);
  const result = await loader({
    request,
    params: {},
    url: new URL(request.url),
    pattern: "/",
    context: new RouterContextProvider(),
  });
  assert.ok(!(result instanceof Response));
  return result;
};
test(
  "link states are shown on page load without consuming the links",
  { skip: !enabled },
  async () => {
    const used = randomBytes(32).toString("base64url");
    const open = randomBytes(32).toString("base64url");
    await db.insert(invitations).values([
      { id: hash(used), used: true, expires: new Date(Date.now() + 60000) },
      { id: hash(open), expires: new Date(Date.now() + 60000) },
    ]);
    const usedPage = await home("invitation=" + used);
    assert.equal(usedPage.invitation, undefined);
    assert.equal(usedPage.invitationUnavailable, true);
    const openPage = await home("invitation=" + open);
    assert.equal(openPage.invitation, open);
    assert.equal(openPage.invitationUnavailable, false);
    assert.equal(
      (await db.query.invitations.findFirst({
        where: eq(invitations.id, hash(open)),
      }))!.used,
      false,
    );

    const [user, disabled] = await db
      .insert(users)
      .values([
        { name: "Recovered", email: randomUUID() + "@test.invalid" },
        {
          name: "Disabled",
          email: randomUUID() + "@test.invalid",
          disabled: true,
        },
      ])
      .returning();
    const [valid, expired, blocked] = ["valid", "expired", "blocked"].map(() =>
      randomBytes(32).toString("base64url"),
    );
    await db.insert(recoveries).values([
      {
        id: hash(valid),
        userId: user.id,
        expires: new Date(Date.now() + 60000),
      },
      {
        id: hash(expired),
        userId: user.id,
        expires: new Date(Date.now() - 1000),
      },
      {
        id: hash(blocked),
        userId: disabled.id,
        expires: new Date(Date.now() + 60000),
      },
    ]);
    for (const value of [expired, blocked, "unknown"]) {
      const page = await home("recovery=" + value);
      assert.deepEqual(page.recovery, { id: value, account: null });
    }
    for (let i = 0; i < 2; i++)
      assert.deepEqual((await home("recovery=" + valid)).recovery, {
        id: valid,
        account: { name: user.name, email: user.email },
      });

    const oldKey = randomBytes(32).toString("base64url");
    await db.insert(passkeys).values({
      id: oldKey,
      userId: user.id,
      publicKey: "old",
      counter: 0,
      transports: [],
    });
    const oldSession = randomUUID();
    await db.insert(sessions).values({
      id: hash(oldSession),
      userId: user.id,
      expires: new Date(Date.now() + 60000),
    });
    const options = await post("register-options", { recovery: valid });
    const replacement = credential((await options.json()).challenge);
    const recovered = await post(
      "register-verify",
      replacement.response,
      cookieOf(options),
    );
    assert.deepEqual(
      (
        await db.query.passkeys.findMany({
          where: eq(passkeys.userId, user.id),
        })
      ).map((key) => key.id),
      [replacement.id],
    );
    assert.equal(
      await viewer(
        new Request(origin, { headers: { cookie: "session=" + oldSession } }),
      ),
      null,
    );
    assert.equal(
      (
        await viewer(
          new Request(origin, { headers: { cookie: cookieOf(recovered) } }),
        )
      )?.id,
      user.id,
    );
    assert.deepEqual((await home("recovery=" + valid)).recovery, {
      id: valid,
      account: null,
    });
    await assert.rejects(post("register-options", { recovery: valid }));
    await assert.rejects(post("register-options", { recovery: blocked }));
  },
);

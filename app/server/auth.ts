import { recoveries, sessions } from "./schema";
import { viewer } from "./security";
import { limitedBody } from "./request";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { challenges, invitations, passkeys, settings, users } from "./schema";
import {
  cookie,
  hash,
  newSession,
  origin,
  rpID,
  sameOrigin,
  setCookie,
  token,
} from "./security";
const enrollment = z.object({
  name: z.string().trim().min(1).max(100),
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  invitation: z.string().max(100).optional(),
  open: z.boolean().optional(),
});
export async function auth(request: Request, action: string) {
  sameOrigin(request);
  if (Number(request.headers.get("content-length")) > 65536)
    throw new Response("Request too large", { status: 413 });
  const body = await (await limitedBody(request, 65536)).json();
  if (action.endsWith("-options")) {
    const register = action === "register-options";
    const payload: Partial<z.infer<typeof enrollment>> = register
      ? enrollment.parse(body)
      : {};
    const configured = await db.query.settings.findFirst();
    let target = register ? await viewer(request) : null;
    let recovery: string | undefined;
    if (register && body.recovery) {
      recovery = hash(z.string().max(100).parse(body.recovery));
      const entry = await db.query.recoveries.findFirst({
        where: and(
          eq(recoveries.id, recovery),
          gt(recoveries.expires, new Date()),
        ),
      });
      if (!entry) throw new Response("Recovery link expired", { status: 403 });
      target =
        (await db.query.users.findFirst({
          where: and(eq(users.id, entry.userId), eq(users.disabled, false)),
        })) || null;
      if (!target) throw new Response("Account unavailable", { status: 403 });
    }
    if (target) {
      payload.name = target.name;
      payload.email = target.email;
    }

    if (
      register &&
      !target &&
      (payload.invitation || (configured && !configured.openRegistration))
    ) {
      const invite = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.id, hash(payload.invitation || "")),
          eq(invitations.used, false),
          gt(invitations.expires, new Date()),
        ),
      });
      if (!invite)
        throw new Response("A valid invitation is required", { status: 403 });
    }
    const options = register
      ? await generateRegistrationOptions({
          rpName: "Wavecase",
          rpID,
          userName: payload.email!,
          userDisplayName: payload.name!,
          authenticatorSelection: {
            residentKey: "required",
            userVerification: "required",
          },
        })
      : await generateAuthenticationOptions({
          rpID,
          userVerification: "required",
        });
    const value = token();
    await db.insert(challenges).values({
      id: hash(value),
      kind: register ? "register" : "login",
      value: options.challenge,
      payload: {
        ...payload,
        bootstrap: !configured,
        targetId: target?.id,
        recovery,
      },
      expires: new Date(Date.now() + 300000),
    });
    return Response.json(options, {
      headers: { "Set-Cookie": setCookie("challenge", value, 300) },
    });
  }
  const key = hash(cookie(request, "challenge") || "");
  const [challenge] = await db
    .delete(challenges)
    .where(and(eq(challenges.id, key), gt(challenges.expires, new Date())))
    .returning();
  if (!challenge)
    throw new Response("Challenge expired. Please try again.", { status: 400 });
  let userId: string;
  if (action === "register-verify" && challenge.kind === "register") {
    const verified = await verifyRegistrationResponse({
      response: body,
      expectedChallenge: challenge.value,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
    if (!verified.verified || !verified.registrationInfo)
      throw new Response("Passkey verification failed", { status: 400 });
    const credential = verified.registrationInfo.credential;
    userId = await db.transaction(async (tx) => {
      // Serialize setup and invitation consumption, including parallel verification requests.
      await tx.execute(sql`select pg_advisory_xact_lock(827264)`);
      const configured = await tx.query.settings.findFirst();
      const p = challenge.payload;
      if (p.targetId) {
        const target = await tx.query.users.findFirst({
          where: and(eq(users.id, p.targetId), eq(users.disabled, false)),
        });
        if (!target) throw new Response("Account unavailable", { status: 403 });
        if (p.recovery) {
          const [entry] = await tx
            .delete(recoveries)
            .where(
              and(
                eq(recoveries.id, p.recovery),
                eq(recoveries.userId, target.id),
                gt(recoveries.expires, new Date()),
              ),
            )
            .returning();
          if (!entry)
            throw new Response("Recovery link expired", { status: 403 });
          await tx.delete(passkeys).where(eq(passkeys.userId, target.id));
          await tx.delete(sessions).where(eq(sessions.userId, target.id));
        } else {
          const current = await viewer(request);
          if (current?.id !== target.id)
            throw new Response("Sign in again to add a passkey", {
              status: 403,
            });
        }
        await tx.insert(passkeys).values({
          id: credential.id,
          userId: target.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64"),
          counter: credential.counter,
          transports: credential.transports || [],
        });
        return target.id;
      }
      if (p.bootstrap && configured)
        throw new Response("Setup has already completed", { status: 409 });
      if (p.invitation || (configured && !configured.openRegistration)) {
        const [invite] = await tx
          .update(invitations)
          .set({ used: true })
          .where(
            and(
              eq(invitations.id, hash(p.invitation || "")),
              eq(invitations.used, false),
              gt(invitations.expires, new Date()),
            ),
          )
          .returning();
        if (!invite)
          throw new Response("Invitation is no longer valid", { status: 403 });
      }
      const [user] = await tx
        .insert(users)
        .values({ name: p.name!, email: p.email!, admin: !configured })
        .returning();
      await tx.insert(passkeys).values({
        id: credential.id,
        userId: user.id,
        publicKey: Buffer.from(credential.publicKey).toString("base64"),
        counter: credential.counter,
        transports: credential.transports || [],
      });
      if (!configured)
        await tx
          .insert(settings)
          .values({ id: 1, openRegistration: p.open || false });
      return user.id;
    });
  } else if (action === "login-verify" && challenge.kind === "login") {
    const key = await db.query.passkeys.findFirst({
      where: eq(passkeys.id, body.id),
    });
    if (!key) throw new Response("Passkey not recognized", { status: 400 });
    const result = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge.value,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: key.id,
        publicKey: Buffer.from(key.publicKey, "base64"),
        counter: key.counter,
      },
    });
    if (!result.verified)
      throw new Response("Passkey verification failed", { status: 400 });
    const user = await db.query.users.findFirst({
      where: and(eq(users.id, key.userId), eq(users.disabled, false)),
    });
    if (!user) throw new Response("Account unavailable", { status: 403 });
    await db
      .update(passkeys)
      .set({ counter: result.authenticationInfo.newCounter })
      .where(eq(passkeys.id, key.id));
    userId = key.userId;
  } else throw new Response("Invalid authentication flow", { status: 400 });
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": await newSession(userId) } },
  );
}

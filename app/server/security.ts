import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "./db";
import {
  artistInvitations,
  challenges,
  invitations,
  recoveries,
  sessions,
  users,
} from "./schema";
import { appUrl } from "./config";
export const origin = new URL(appUrl()).origin;
export const rpID = new URL(origin).hostname;
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function cookie(request: Request, name: string) {
  return request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(name + "="))
    ?.slice(name.length + 1);
}
export function setCookie(name: string, value: string, maxAge: number) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${origin.startsWith("https:") ? "; Secure" : ""}`;
}
export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== origin)
    throw new Response(
      `Wavecase only accepts forms sent from ${origin}. Open Wavecase at that address and try again.`,
      { status: 403 },
    );
}
export async function viewer(request: Request) {
  const value = cookie(request, "session");
  if (!value) return null;
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.id, hash(value)),
        gt(sessions.expires, new Date()),
        eq(users.disabled, false),
      ),
    );
  return row?.user || null;
}
export async function requireUser(request: Request) {
  const user = await viewer(request);
  if (!user) throw new Response("Authentication required", { status: 401 });
  return user;
}
export async function newSession(userId: string) {
  const value = token();
  await db.insert(sessions).values({
    id: hash(value),
    userId,
    expires: new Date(Date.now() + 30 * 86400000),
  });
  return setCookie("session", value, 30 * 86400);
}
export async function deleteExpiredTokens() {
  const now = new Date();
  for (const table of [
    challenges,
    sessions,
    recoveries,
    invitations,
    artistInvitations,
  ])
    await db.delete(table).where(lt(table.expires, now));
}

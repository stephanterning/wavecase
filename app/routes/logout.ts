import { redirect, type ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { sessions } from "../server/schema";
import { cookie, hash, sameOrigin, setCookie } from "../server/security";
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  await db
    .delete(sessions)
    .where(eq(sessions.id, hash(cookie(request, "session") || "")));
  return redirect("/", {
    headers: { "Set-Cookie": setCookie("session", "", 0) },
  });
}

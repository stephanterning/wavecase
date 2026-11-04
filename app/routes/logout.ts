import { loginDestination } from "../domain/login-destination";
import { limitedBody } from "../server/request";
import { redirect, type ActionFunctionArgs } from "react-router";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { sessions } from "../server/schema";
import { cookie, hash, sameOrigin, setCookie } from "../server/security";
export async function action({ request }: ActionFunctionArgs) {
  sameOrigin(request);
  const form = request.headers
    .get("Content-Type")
    ?.startsWith("application/x-www-form-urlencoded")
    ? await (await limitedBody(request, 2048)).formData()
    : null;
  const returnTo = loginDestination(form?.get("returnTo"));
  await db
    .delete(sessions)
    .where(eq(sessions.id, hash(cookie(request, "session") || "")));
  return redirect(
    returnTo === "/dashboard"
      ? "/"
      : "/?returnTo=" + encodeURIComponent(returnTo),
    {
      headers: { "Set-Cookie": setCookie("session", "", 0) },
    },
  );
}

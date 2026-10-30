import type { ActionFunctionArgs } from "react-router";
import { auth } from "../server/auth";
import { ZodError } from "zod";
export async function action({ request, params }: ActionFunctionArgs) {
  if (
    ![
      "register-options",
      "register-verify",
      "login-options",
      "login-verify",
    ].includes(params.action || "")
  )
    throw new Response("Not found", { status: 404 });
  try {
    return await auth(request, params.action!);
  } catch (error) {
    if (error instanceof Response) throw error;
    if (error instanceof ZodError)
      return Response.json(
        { error: "Check your name and email address." },
        { status: 400 },
      );
    console.error(
      "Authentication failed",
      error instanceof Error ? error.message : "Unknown error",
    );
    return Response.json(
      { error: "Could not complete authentication. Please try again." },
      { status: 400 },
    );
  }
}

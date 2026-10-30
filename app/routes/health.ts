import { sql } from "drizzle-orm";
import { db } from "../server/db";
export async function loader() {
  await db.execute(sql`select 1`);
  return new Response("ok", { headers: { "Cache-Control": "no-store" } });
}

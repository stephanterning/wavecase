import { eq } from "drizzle-orm";
import { db, pool } from "../app/server/db";
import { users, recoveries } from "../app/server/schema";
import { token, hash, origin } from "../app/server/security";
const email = process.argv[2];
if (!email)
  throw new Error("Usage: npm run recover -- administrator@example.com");
const user = await db.query.users.findFirst({
  where: eq(users.email, email.toLowerCase()),
});
if (!user?.admin) throw new Error("Administrator account not found");
const value = token();
await db.insert(recoveries).values({
  id: hash(value),
  userId: user.id,
  expires: new Date(Date.now() + 15 * 60000),
});
console.log("Single-use recovery link, valid for 15 minutes:");
console.log(origin + "/?recovery=" + value);
await pool.end();

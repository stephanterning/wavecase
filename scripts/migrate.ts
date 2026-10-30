import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../app/server/db";
await migrate(db, { migrationsFolder: "drizzle" });
await pool.end();

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set, for example postgres://wavecase:password@127.0.0.1:5432/wavecase_dev",
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10_000 });
try {
  await pool.query("select 1");
} catch (error) {
  const { message, code } = error as NodeJS.ErrnoException;
  console.error(`Could not connect to the database: ${message || code}`);
  process.exit(1);
}
await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
await pool.end();
console.log("Migrations applied");

import { PgBoss } from "pg-boss";
export const boss = new PgBoss(process.env.DATABASE_URL!);
boss.on("error", (error) => console.error("Job queue error", error.message));
let started: Promise<void> | undefined;
export function queue() {
  return (started ||= (async () => {
    await boss.start();
    await boss.createQueue("process-release", {
      policy: "exclusive",
      retryLimit: 3,
      retryDelay: 10,
    });
    await boss.createQueue("process-audio", {
      policy: "exclusive",
      retryLimit: 3,
      retryDelay: 10,
    });
  })());
}

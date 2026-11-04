import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import { events, links, tracks, users } from "../app/server/schema";
import { origin } from "../app/server/security";
import { action as visit } from "../app/routes/visits";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
after(() => pool.end());

test(
  "listener event times cannot move into the future or far into the past",
  { skip: !enabled },
  async () => {
    const owner = randomUUID(),
      track = randomUUID(),
      link = "event-time-" + randomUUID();
    await db.insert(users).values({
      id: owner,
      name: "Event owner",
      email: owner + "@test.invalid",
    });
    await db
      .insert(tracks)
      .values({ id: track, ownerId: owner, title: "Time" });
    await db.insert(links).values({ id: link, trackId: track, label: "Time" });
    const hour = 3600000;
    const recorded = async (occurredAt: number) => {
      const id = randomUUID();
      await visit({
        request: new Request(origin + "/visits/" + link, {
          method: "POST",
          headers: { origin, "Content-Type": "application/json" },
          body: JSON.stringify({
            id,
            occurredAt: new Date(occurredAt).toISOString(),
            browser: randomUUID(),
            session: randomUUID(),
            name: null,
            kind: "visit",
            position: 0,
          }),
        }),
        params: { share: link },
        url: new URL(origin + "/visits/" + link),
        pattern: "/",
        context: new RouterContextProvider(),
      });
      const event = await db.query.events.findFirst({
        where: eq(events.id, id),
      });
      return event!.createdAt.getTime();
    };
    const recent = Date.now() - hour;
    assert.equal(await recorded(recent), recent);
    const before = Date.now();
    assert.ok((await recorded(before + 24 * hour)) <= Date.now());
    const old = await recorded(before - 72 * hour);
    assert.ok(old >= before - 24 * hour && old <= Date.now() - 24 * hour);
  },
);

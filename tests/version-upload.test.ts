import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { nextVersionName, versionNameFromFile } from "../app/domain/versions";
import { db, pool } from "../app/server/db";
import { boss } from "../app/server/queue";
import { users, sessions, tracks, versions } from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { action } from "../app/routes/track";
import { enabled } from "./database";
after(async () => {
  if (enabled) await boss.stop();
  await pool.end();
});

test("suggested version names follow the filename or the highest vN", () => {
  assert.equal(versionNameFromFile("Kiosken_v3.2_master.wav"), "v3.2");
  assert.equal(versionNameFromFile("Kiosken final.wav"), undefined);
  assert.equal(nextVersionName([]), "v1");
  assert.equal(nextVersionName(["v1"]), "v2");
  assert.equal(nextVersionName(["v1", "v3.2 loud", "Final mix"]), "v4");
  assert.equal(nextVersionName(["Final mix"]), "v1");
});

test(
  "uploads default to early idea, avoid existing names and return the new version",
  { skip: !enabled },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-upload-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    const owner = randomUUID(),
      token = randomUUID(),
      track = randomUUID();
    const upload = async (filename: string) => {
      const form = new FormData();
      form.set("intent", "upload-version");
      form.set("audio", new File(["not audio"], filename));
      const request = new Request(`${origin}/tracks/${track}`, {
        method: "POST",
        headers: { origin, cookie: `session=${token}` },
        body: form,
      });
      const result = await action({
        request,
        params: { id: track },
        url: new URL(request.url),
        pattern: "/",
        context: new RouterContextProvider(),
      });
      assert.ok("version" in result && typeof result.version === "string");
      return db.query.versions.findFirst({
        where: eq(versions.id, result.version),
      });
    };
    await db.insert(users).values({
      id: owner,
      name: "Owner",
      email: `${owner}@test.invalid`,
    });
    try {
      await db.insert(sessions).values({
        id: hash(token),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      await db.insert(tracks).values({ id: track, ownerId: owner, title: "T" });
      const [first] = await db
        .insert(versions)
        .values({ trackId: track, name: "v1", filename: "take.wav" })
        .returning();
      assert.equal(first.status, "early idea");

      const second = await upload("take.wav");
      assert.equal(second?.name, "v2");
      assert.equal(second?.status, "early idea");
      assert.equal(second?.state, "processing");

      assert.equal((await upload("take_v7.wav"))?.name, "v7");
    } finally {
      await db.delete(versions).where(eq(versions.trackId, track));
      await db.delete(tracks).where(eq(tracks.id, track));
      await db.delete(sessions).where(eq(sessions.userId, owner));
      await db.delete(users).where(eq(users.id, owner));
      await rm(directory, { recursive: true, force: true });
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    }
  },
);

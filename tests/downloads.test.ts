import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { db, pool } from "../app/server/db";
import {
  users,
  tracks,
  versions,
  links,
  sessions,
  events,
} from "../app/server/schema";
import { processAudio } from "../app/server/audio";
import { loader as media } from "../app/routes/media";
import { hash, origin } from "../app/server/security";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
after(() => pool.end());

test(
  "download formats enforce permissions, cache one MP3 and remove it with audio",
  { skip: !enabled },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "wavecase-downloads-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = directory;
    try {
      const owner = randomUUID(),
        track = randomUUID(),
        version = randomUUID(),
        link = randomUUID(),
        session = randomUUID();
      await db
        .insert(users)
        .values({ id: owner, name: "Owner", email: owner + "@test.invalid" });
      await db.insert(sessions).values({
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      await db
        .insert(tracks)
        .values({ id: track, ownerId: owner, title: "Downloads" });
      await db.insert(links).values({
        id: link,
        trackId: track,
        label: "Listener",
        download: false,
      });
      await promisify(execFile)("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=1:sample_rate=48000",
        "-c:a",
        "pcm_s24le",
        join(directory, "master.wav"),
      ]);
      const result = await processAudio(directory, "master.wav");
      await db.insert(versions).values({
        id: version,
        trackId: track,
        name: "v1",
        filename: "Master.wav",
        state: "ready",
        download: true,
        ...result,
      });
      const args = {
        params: { id: version },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/media/:id",
      };
      const get = (
        format: string,
        headers: Record<string, string> = {},
        method = "GET",
      ) =>
        media({
          ...args,
          request: new Request(
            origin + "?share=" + link + "&download=1&format=" + format,
            { headers, method },
          ),
        });
      const status = (code: number) => (error: unknown) =>
        error instanceof Response && error.status === code;
      await assert.rejects(get("mp3"), status(403));
      assert.deepEqual(await readdir(directory), ["master.wav"]);
      await db.update(links).set({ download: true }).where(eq(links.id, link));
      await db
        .update(versions)
        .set({ download: false })
        .where(eq(versions.id, version));
      await assert.rejects(get("mp3"), status(403));
      await db
        .update(versions)
        .set({ download: true })
        .where(eq(versions.id, version));
      await assert.rejects(get("flac"), status(400));
      const wav = await get("wav");
      assert.equal(wav.headers.get("Content-Type"), "audio/wav");
      assert.equal(
        Buffer.from(await wav.arrayBuffer())
          .subarray(0, 4)
          .toString(),
        "RIFF",
      );
      const simultaneous = await Promise.all([get("mp3"), get("mp3")]);
      const bytes = await Promise.all(simultaneous.map((r) => r.arrayBuffer()));
      assert.deepEqual(bytes[0], bytes[1]);
      assert.equal(simultaneous[0].headers.get("Content-Type"), "audio/mpeg");
      assert.match(
        simultaneous[0].headers.get("Content-Disposition")!,
        /Master.mp3/,
      );
      const cached = await stat(join(directory, "master.wav.mp3"));
      const partial = await get("mp3", { range: "bytes=2-5" });
      assert.equal(partial.status, 206);
      assert.deepEqual(
        Buffer.from(await partial.arrayBuffer()),
        Buffer.from(bytes[0]).subarray(2, 6),
      );
      const head = await get("mp3", {}, "HEAD");
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal(
        (await stat(join(directory, "master.wav.mp3"))).mtimeMs,
        cached.mtimeMs,
      );
      const recorded = await db
        .select()
        .from(events)
        .where(eq(events.versionId, version));
      assert.equal(recorded.length, 3);
      assert.equal((recorded[1].context as { format: string }).format, "mp3");
      // Hold the same row lock used during encoding, then revoke the link while
      // the already-authorized request is waiting. Cached exports must recheck too.
      const blocker = await pool.connect();
      let waiting: Promise<Response | unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM versions WHERE id = $1 FOR UPDATE",
          [version],
        );
        const {
          rows: [{ pid }],
        } = await blocker.query("SELECT pg_backend_pid() AS pid");
        waiting = get("mp3").catch((error: unknown) => error);
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const { rows } = await pool.query(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          );
          blocked = rows[0].blocked;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(
          blocked,
          true,
          "Download should be waiting for the encoding lock",
        );
        await db.update(links).set({ active: false }).where(eq(links.id, link));
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const revoked = await waiting;
      assert.ok(revoked instanceof Response && revoked.status === 404);
      await db.update(links).set({ active: true }).where(eq(links.id, link));
      await db
        .update(versions)
        .set({ metadata: { ...result.metadata, wavDownload: false } })
        .where(eq(versions.id, version));
      await assert.rejects(get("wav"), status(400));
      await db.update(links).set({ active: false }).where(eq(links.id, link));
      await assert.rejects(get("mp3"), status(404));
      await db.update(links).set({ active: true }).where(eq(links.id, link));
      const form = new FormData();
      form.set("intent", "remove");
      form.set("version", version);
      const { action: manage } = await import("../app/routes/manage");
      await manage({
        ...args,
        params: { id: track },
        request: new Request(origin, {
          method: "POST",
          headers: { origin, cookie: "session=" + session },
          body: form,
        }),
      });
      assert.deepEqual(await readdir(directory), []);
      await assert.rejects(get("mp3"), status(404));
    } finally {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

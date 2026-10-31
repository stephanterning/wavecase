import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  artists,
} from "../app/server/schema";
import { processAudio } from "../app/server/audio";
import { inflateRawSync } from "node:zlib";
import { action as download, loader as media } from "../app/routes/media";
import { hash, origin } from "../app/server/security";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
after(() => pool.end());

function unzip(buffer: ArrayBuffer) {
  const zip = Buffer.from(buffer);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let cursor = zip.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let n = 0; n < zip.readUInt16LE(end + 10); n++) {
    const nameLength = zip.readUInt16LE(cursor + 28);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    const size = zip.readUInt32LE(cursor + 20),
      offset = zip.readUInt32LE(cursor + 42);
    const start =
      offset +
      30 +
      zip.readUInt16LE(offset + 26) +
      zip.readUInt16LE(offset + 28);
    const bytes = zip.subarray(start, start + size);
    files.set(
      name,
      zip.readUInt16LE(cursor + 10) === 8 ? inflateRawSync(bytes) : bytes,
    );
    cursor +=
      46 +
      nameLength +
      zip.readUInt16LE(cursor + 30) +
      zip.readUInt16LE(cursor + 32);
  }
  return files;
}

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
        session = randomUUID(),
        artist = randomUUID();
      await db
        .insert(users)
        .values({ id: owner, name: "Owner", email: owner + "@test.invalid" });
      await db.insert(sessions).values({
        id: hash(session),
        userId: owner,
        expires: new Date(Date.now() + 60000),
      });
      await db
        .insert(artists)
        .values({ id: artist, ownerId: owner, name: "Åsa", slug: artist });
      await writeFile(join(directory, "cover.jpg"), "artwork bytes");
      await db.insert(tracks).values({
        id: track,
        ownerId: owner,
        artistId: artist,
        artist: "Old artist",
        title: "Downloads",
        description: "Track notes",
        cover: "cover.jpg",
      });
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
        description: "Version notes",
        status: "finished",
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
        fields: Record<string, string> = {},
        headers: Record<string, string> = {},
      ) =>
        download({
          ...args,
          request: new Request(origin + "/media/" + version, {
            method: "POST",
            headers: { origin, ...headers },
            body: new URLSearchParams({
              share: link,
              email: " listener@example.test ",
              format,
              ...fields,
            }),
          }),
        });
      const oldGet = (method = "GET") =>
        media({
          ...args,
          request: new Request(
            origin +
              "?share=" +
              link +
              "&download=1&email=listener@example.test",
            { method },
          ),
        });
      const status = (code: number) => (error: unknown) =>
        error instanceof Response && error.status === code;
      await assert.rejects(get("mp3"), status(403));
      assert.deepEqual(await readdir(directory), ["cover.jpg", "master.wav"]);
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
      await assert.rejects(get("mp3", { email: "" }), status(400));
      await assert.rejects(
        get("mp3", { email: "bad", owner: "true" }),
        status(400),
      );
      await assert.rejects(
        get("wav", {}, { origin: "https://other.test" }),
        status(403),
      );
      await assert.rejects(oldGet(), status(405));
      await assert.rejects(oldGet("HEAD"), status(405));
      assert.deepEqual(await readdir(directory), ["cover.jpg", "master.wav"]);
      const wav = await get("wav");
      assert.equal(wav.headers.get("Content-Type"), "application/zip");
      assert.equal(wav.headers.get("Cache-Control"), "private, no-store");
      const folder = "Åsa - Downloads - v1";
      assert.match(
        wav.headers.get("Content-Disposition")!,
        /%C3%85sa%20-%20Downloads%20-%20v1.zip/,
      );
      const wavFiles = unzip(await wav.arrayBuffer());
      assert.deepEqual(
        [...wavFiles.keys()],
        [
          `${folder}/${folder}.wav`,
          `${folder}/artwork.jpg`,
          `${folder}/demo-info.txt`,
        ],
      );
      assert.deepEqual(
        wavFiles.get(`${folder}/${folder}.wav`),
        await readFile(join(directory, "master.wav")),
      );
      assert.equal(
        wavFiles.get(`${folder}/artwork.jpg`)!.toString(),
        "artwork bytes",
      );
      const info = wavFiles.get(`${folder}/demo-info.txt`)!.toString();
      for (const text of [
        "Pre-release version. Do not share.",
        "Artist: Åsa",
        "Title: Downloads",
        "Version: v1",
        "Status: finished",
        "Uploaded:",
        "Track notes",
        "Version notes",
      ])
        assert.ok(info.includes(text), text);
      for (const text of [link, owner, "@test", "@example", "Old artist"])
        assert.ok(!info.includes(text), text);
      const simultaneous = await Promise.all([get("mp3"), get("mp3")]);
      const bytes = await Promise.all(
        simultaneous.map(async (r) =>
          unzip(await r.arrayBuffer()).get(`${folder}/${folder}.mp3`)!,
        ),
      );
      assert.deepEqual(bytes[0], bytes[1]);
      assert.deepEqual(
        bytes[0],
        await readFile(join(directory, "master.wav.mp3")),
      );
      const cached = await stat(join(directory, "master.wav.mp3"));
      // An authenticated owner downloads a ZIP without email and creates no listener event.
      await db
        .update(versions)
        .set({ download: false })
        .where(eq(versions.id, version));
      const own = await get(
        "mp3",
        { email: "", share: "" },
        { cookie: "session=" + session },
      );
      assert.deepEqual(
        unzip(await own.arrayBuffer()).get(`${folder}/${folder}.mp3`),
        bytes[0],
      );
      await db
        .update(versions)
        .set({ download: true })
        .where(eq(versions.id, version));
      assert.equal(
        (await stat(join(directory, "master.wav.mp3"))).mtimeMs,
        cached.mtimeMs,
      );
      const recorded = await db
        .select()
        .from(events)
        .where(eq(events.versionId, version));
      assert.equal(recorded.length, 3);
      assert.ok(
        recorded.every(
          (e) =>
            (e.context as { email: string }).email === "listener@example.test",
        ),
      );
      assert.equal(
        recorded.filter(
          (e) => (e.context as { format: string }).format === "mp3",
        ).length,
        2,
      );
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
      await db
        .update(versions)
        .set({ metadata: {}, filename: "Legacy".repeat(40) + ".aiff" })
        .where(eq(versions.id, version));
      await db.update(tracks).set({ cover: null }).where(eq(tracks.id, track));
      await assert.rejects(get("original", { email: "" }), status(400));
      const legacyWav = unzip(await (await get("wav")).arrayBuffer());
      assert.deepEqual(
        legacyWav.get(`${folder}/${folder}.wav`),
        await readFile(join(directory, "master.wav")),
      );
      const legacyMp3 = unzip(await (await get("mp3")).arrayBuffer());
      assert.deepEqual(legacyMp3.get(`${folder}/${folder}.mp3`), bytes[0]);
      const legacy = unzip(await (await get("original")).arrayBuffer());
      assert.deepEqual(
        [...legacy.keys()],
        [`${folder}/${folder}.aiff`, `${folder}/demo-info.txt`],
      );
      assert.deepEqual(
        legacy.get(`${folder}/${folder}.aiff`),
        await readFile(join(directory, "master.wav")),
      );
      await db
        .update(versions)
        .set({ original: "master.wav.mp3", metadata: {} })
        .where(eq(versions.id, version));
      await assert.rejects(get("wav"), status(400));
      await (await get("mp3")).arrayBuffer();
      // Restore the original so the existing removal flow can be exercised.
      const { removeAudioFiles } = await import("../app/server/audio-files");
      await removeAudioFiles(directory, ["master.wav.mp3.mp3"]);
      await db
        .update(versions)
        .set({ original: "master.wav" })
        .where(eq(versions.id, version));
      const { loader: analytics } = await import("../app/routes/analytics");
      await assert.rejects(
        analytics({
          ...args,
          params: { id: track },
          request: new Request(origin + "?share=" + link),
        }),
        status(404),
      );
      const stats = await analytics({
        ...args,
        params: { id: track },
        request: new Request(origin, {
          headers: { cookie: "session=" + session },
        }),
      });
      assert.equal(stats.events.length, 7);
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
      assert.deepEqual(await readdir(directory), ["cover.jpg"]);
      const clear = new FormData();
      clear.set("intent", "clear-analytics");
      await manage({
        ...args,
        params: { id: track },
        request: new Request(origin, {
          method: "POST",
          headers: { origin, cookie: "session=" + session },
          body: clear,
        }),
      });
      assert.equal(
        (await db.select().from(events).where(eq(events.versionId, version)))
          .length,
        0,
      );
      await assert.rejects(get("original"), status(404));
    } finally {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("legacy formats use the actual codec and cache lossless WAV exports", async () => {
  const { demoWavAvailable, encodeWav, encodeMp3 } =
    await import("../app/server/download");
  const { removeAudioFiles } = await import("../app/server/audio-files");
  const directory = await mkdtemp(join(tmpdir(), "wavecase-legacy-"));
  try {
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=0.1:sample_rate=44100",
      "-c:a",
      "flac",
      "-f",
      "flac",
      join(directory, "lossless"),
    ]);
    assert.equal(
      await demoWavAvailable({ original: "lossless", metadata: {} }, directory),
      true,
    );
    const wav = await encodeWav(directory, "lossless");
    const cached = await stat(join(directory, wav));
    assert.equal(await encodeWav(directory, "lossless"), wav);
    assert.equal((await stat(join(directory, wav))).mtimeMs, cached.mtimeMs);
    const bytes = await readFile(join(directory, wav));
    assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
    const mp3 = await encodeMp3(directory, "lossless");
    assert.equal(
      await demoWavAvailable({ original: mp3, metadata: null }, directory),
      false,
    );
    await assert.rejects(
      encodeWav(directory, mp3),
      (e: unknown) => e instanceof Response && e.status === 400,
    );
    await removeAudioFiles(directory, ["lossless"]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy 32-bit AIFF WAV exports dither at 24 bits", async () => {
  const { encodeWav } = await import("../app/server/download");
  const directory = await mkdtemp(join(tmpdir(), "wavecase-legacy-dither-"));
  try {
    await promisify(execFile)("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=mono",
      "-t",
      "0.1",
      "-c:a",
      "pcm_s32be",
      join(directory, "silence.aiff"),
    ]);
    const key = await encodeWav(directory, "silence.aiff");
    const { stdout } = await promisify(execFile)(
      "ffmpeg",
      ["-v", "error", "-i", join(directory, key), "-f", "s32le", "-"],
      { encoding: "buffer" },
    );
    const samples = Array.from({ length: stdout.length / 4 }, (_, i) =>
      stdout.readInt32LE(i * 4),
    );
    assert.ok(samples.some((v) => v === 0));
    assert.ok(samples.some((v) => v < 0));
    assert.ok(samples.every((v) => Math.abs(v) <= 256 && v % 256 === 0));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

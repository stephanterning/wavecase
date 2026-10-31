import { downloadName, zipDisposition } from "../app/server/release-filenames";
import { RouterContextProvider } from "react-router";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { and, eq } from "drizzle-orm";
import {
  slugify,
  slugSchema,
  parseLinks,
  releaseInfo,
} from "../app/domain/releases";
import {
  processReleaseAudio,
  measureReleasePlayback,
} from "../app/server/release-audio";
import { db, pool } from "../app/server/db";
import {
  artists,
  releases,
  releaseTracks,
  releaseEvents,
  users,
  sessions,
} from "../app/server/schema";
import { hash, origin } from "../app/server/security";
import { releaseAccess } from "../app/server/releases";
import {
  action as assetAction,
  loader as assetLoader,
} from "../app/routes/release-assets";

import { loader as artistLoader } from "../app/routes/artist";
import { loader as releaseLoader } from "../app/routes/release-page";
const enabled = process.env.DATABASE_URL?.endsWith("/wavecase_test");
process.env.DATABASE_URL ??= "postgres://localhost/wavecase_test";
const { action: editAction } = await import("../app/routes/release-edit");
after(() => pool.end());
const exec = promisify(execFile);
test("release addresses, external URLs and package metadata", () => {
  assert.equal(slugify("Mårtin Dice — Pressure!"), "martin-dice-pressure");
  assert.equal(slugSchema.safeParse("../bad").success, false);
  assert.throws(() => parseLinks("Bad | javascript:alert(1)"));
  assert.deepEqual(parseLinks("Bandcamp | https://example.com/music"), [
    { label: "Bandcamp", url: "https://example.com/music" },
  ]);
  assert.match(
    releaseInfo(
      {
        title: "Pressure",
        kind: "single",
        description: "",
        metadata: { label: "Example" },
      },
      "Martin Dice",
      [],
      2,
    ),
    /Included tracks: 0 of 2/,
  );
});
test("release processing preserves original PCM WAV and produces AAC playback", async () => {
  const dir = await mkdtemp(join(tmpdir(), "release-audio-"));
  try {
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "sine=duration=2:sample_rate=48000",
      "-ac",
      "2",
      "-c:a",
      "pcm_s24le",
      join(dir, "master.wav"),
    ]);
    const original = await readFile(join(dir, "master.wav"));
    const result = await processReleaseAudio(dir, "master.wav");
    assert.equal(result.sampleRate, 48000);
    assert.equal(result.bitDepth, 24);
    assert.equal(typeof result.audioMeasurements.lufs, "number");
    assert.equal(typeof result.audioMeasurements.peak, "number");
    assert.equal(typeof result.audioMeasurements.truePeak, "number");
    const playbackBytes = await readFile(join(dir, result.playback));
    assert.deepEqual(
      await measureReleasePlayback(dir, result.playback),
      result.audioMeasurements,
    );
    assert.deepEqual(await readFile(join(dir, result.playback)), playbackBytes);
    assert.deepEqual(await readFile(join(dir, "master.wav")), original);
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      join(dir, result.playback),
    ]);
    assert.equal(JSON.parse(stdout).streams[0].codec_name, "aac");
    await exec("ffmpeg", [
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=stereo",
      "-t",
      "1",
      join(dir, "silence.wav"),
    ]);
    const silence = await processReleaseAudio(dir, "silence.wav");
    assert.deepEqual(silence.audioMeasurements, {
      lufs: null,
      peak: null,
      truePeak: null,
    });
    await writeFile(join(dir, "bad.wav"), "not wav");
    await assert.rejects(processReleaseAudio(dir, "bad.wav"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test(
  "public releases enforce ownership, publication and coupled audio access; gated ZIPs contain exact masters",
  { skip: !enabled },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "release-flow-"));
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = dir;
    try {
      const owner = randomUUID(),
        other = randomUUID(),
        artist = randomUUID(),
        release = randomUUID(),
        track = randomUUID(),
        unavailable = randomUUID();
      const session = randomUUID();
      const outsiderSession = randomUUID();
      await db.insert(users).values([
        { id: owner, name: "Owner", email: `${owner}@example.test` },
        {
          id: other,
          name: "Other admin",
          email: `${other}@example.test`,
          admin: true,
        },
      ]);
      await db.insert(sessions).values([
        {
          id: hash(session),
          userId: owner,
          expires: new Date(Date.now() + 60000),
        },
        {
          id: hash(outsiderSession),
          userId: other,
          expires: new Date(Date.now() + 60000),
        },
      ]);
      await db.insert(artists).values({
        id: artist,
        ownerId: owner,
        name: "Martin Dice",
        slug: `artist-${artist}`,
      });
      await db.insert(releases).values({
        id: release,
        artistId: artist,
        title: "Pressure",
        slug: "pressure",
        kind: "ep",
        cover: "artwork.png",
        metadata: { label: "Test label", credits: "Release credits" },
        links: [{ label: "Bandcamp", url: "https://example.com/music" }],
      });
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=duration=1:sample_rate=44100",
        "-c:a",
        "pcm_s16le",
        join(dir, "master.wav"),
      ]);
      const result = await processReleaseAudio(dir, "master.wav");
      await exec("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=2000x1000",
        "-frames:v",
        "1",
        join(dir, "artwork.png"),
      ]);
      const originalArtwork = await readFile(join(dir, "artwork.png"));
      await db.insert(releaseTracks).values([
        {
          id: track,
          releaseId: release,
          title: "Blå timmen",
          position: 3,
          original: "master.wav",
          ...result,
          metadata: {
            artist: "Åsa Öberg",
            isrc: "SEAAA2600001",
            credits: "Track credits",
          },
        },
        { id: unavailable, releaseId: release, title: "Bonus", position: 2 },
      ]);
      const request = (cookie?: string) =>
        new Request(origin, {
          headers: cookie ? { cookie: `session=${cookie}` } : {},
        });
      const args = (req: Request, kind: string) => ({
        request: req,
        params: { id: release, kind },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/",
      });
      const post = (values: Record<string, string>, cookie?: string) =>
        new Request(origin, {
          method: "POST",
          headers: {
            origin,
            ...(cookie ? { cookie: `session=${cookie}` } : {}),
          },
          body: new URLSearchParams(values),
        });
      const denied = (status: number) => (e: unknown) =>
        e instanceof Response && e.status === status;
      const page = (cookie?: string) =>
        releaseLoader({
          ...args(request(cookie), ""),
          params: { artist: `artist-${artist}`, release: "pressure" },
        });
      await assert.rejects(releaseAccess(request(), release), denied(404));
      for (const cookie of [undefined, outsiderSession])
        await assert.rejects(
          assetLoader(args(request(cookie), "artwork.jpg")),
          denied(404),
        );
      const previewArtwork = await assetLoader(
        args(request(session), "artwork.jpg"),
      );
      assert.equal(previewArtwork.headers.get("content-type"), "image/jpeg");
      const thumbnail = Buffer.from(await previewArtwork.arrayBuffer());
      await writeFile(join(dir, "thumbnail.jpg"), thumbnail);
      const { stdout: thumbnailInfo } = await exec("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        join(dir, "thumbnail.jpg"),
      ]);
      const image = JSON.parse(thumbnailInfo).streams[0];
      assert.equal(image.codec_name, "mjpeg");
      assert.equal(image.width, 512);
      assert.equal(image.height, 512);
      assert.ok(thumbnail.length < 200_000);
      assert.deepEqual(
        await readFile(join(dir, "artwork.png")),
        originalArtwork,
      );
      assert.deepEqual((await page(session)).mediaArtwork, {
        src: `${origin}/release-assets/${release}/artwork.jpg?v=artwork.png`,
        sizes: "512x512",
        type: "image/jpeg",
      });
      await assert.rejects(
        releaseAccess(request(outsiderSession), release, true),
        denied(404),
      );
      assert.equal(
        (await releaseAccess(request(session), release, true)).owner,
        true,
      );
      assert.equal(
        (
          await artistLoader({
            request: request(),
            params: { artist: `artist-${artist}` },
            context: new RouterContextProvider(),
            url: new URL(origin),
            pattern: "/",
          })
        ).releases.length,
        0,
      );
      await editAction({
        request: post({ intent: "publish" }, session),
        params: { id: release },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/",
      });
      const publicArtwork = await assetLoader(args(request(), "artwork.jpg"));
      assert.equal(
        publicArtwork.headers.get("cache-control"),
        "private, no-store",
      );
      assert.equal(
        Number(publicArtwork.headers.get("content-length")),
        thumbnail.length,
      );
      assert.deepEqual(
        Buffer.from(await publicArtwork.arrayBuffer()),
        thumbnail,
      );
      const fullCover = await assetLoader(args(request(), "cover"));
      assert.equal(fullCover.headers.get("content-type"), "image/png");
      assert.deepEqual(
        Buffer.from(await fullCover.arrayBuffer()),
        originalArtwork,
      );
      const head = await assetLoader(
        args(new Request(origin, { method: "HEAD" }), "artwork.jpg"),
      );
      assert.equal(head.headers.get("content-type"), "image/jpeg");
      assert.equal(
        Number(head.headers.get("content-length")),
        thumbnail.length,
      );
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      await assert.rejects(assetLoader(args(request(), "audio")), denied(404));
      await assert.rejects(
        assetAction(args(post({ email: "valid@example.test" }), "download")),
        denied(403),
      );
      await db
        .update(releases)
        .set({ audioEnabled: true })
        .where(eq(releases.id, release));
      const ranged = new Request(
        `${origin}/release-assets/${release}/audio?track=${track}`,
        { headers: { range: "bytes=0-9" } },
      );
      const audio = await assetLoader(args(ranged, "audio"));
      assert.equal(audio.status, 206);
      assert.equal((await audio.arrayBuffer()).byteLength, 10);
      await assert.rejects(
        assetAction(args(post({ email: "invalid" }), "download")),
        denied(400),
      );
      await assert.rejects(
        assetAction(
          args(
            post({ email: "valid@example.test", track: unavailable }),
            "download",
          ),
        ),
        denied(404),
      );
      await assert.rejects(
        assetAction(
          args(
            post({ email: "valid@example.test", format: "flac" }),
            "download",
          ),
        ),
        denied(400),
      );
      for (const format of ["wav", "mp3"]) {
        for (const selection of ["", track]) {
          const response = await assetAction(
            args(
              post({
                email: "not-verified@example.test",
                track: selection,
                format,
              }),
              "download",
            ),
          );
          assert.equal(response.headers.get("content-type"), "application/zip");
          const folder = selection
            ? "Åsa Öberg - Blå timmen"
            : "Martin Dice - Pressure";
          const disposition = response.headers.get("content-disposition")!;
          assert.equal(
            decodeURIComponent(disposition.split("filename*=UTF-8''")[1]),
            folder + ".zip",
          );
          // Read ZIP central directory to verify exact stored WAV and text entries, without another runtime dependency.
          const zip = Buffer.from(await response.arrayBuffer());
          const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
          let cursor = zip.readUInt32LE(end + 16);
          const entries = new Map<string, Buffer>();
          for (let n = 0; n < zip.readUInt16LE(end + 10); n++) {
            const nameLength = zip.readUInt16LE(cursor + 28),
              extra = zip.readUInt16LE(cursor + 30),
              comment = zip.readUInt16LE(cursor + 32);
            const name = zip.toString(
                "utf8",
                cursor + 46,
                cursor + 46 + nameLength,
              ),
              size = zip.readUInt32LE(cursor + 20),
              offset = zip.readUInt32LE(cursor + 42);
            const start =
              offset +
              30 +
              zip.readUInt16LE(offset + 26) +
              zip.readUInt16LE(offset + 28);
            let bytes = zip.subarray(start, start + size);
            if (zip.readUInt16LE(cursor + 10) === 8)
              bytes = (await import("node:zlib")).inflateRawSync(bytes);
            entries.set(name, bytes);
            cursor += 46 + nameLength + extra + comment;
          }
          assert.deepEqual(
            [...entries.keys()].sort(),
            [
              `${folder}/03 - Åsa Öberg - Blå timmen.${format}`,
              `${folder}/artwork.png`,
              `${folder}/release-info.txt`,
            ].sort(),
          );
          assert.deepEqual(
            entries.get(`${folder}/artwork.png`),
            await readFile(join(dir, "artwork.png")),
          );
          assert.deepEqual(
            [...entries].find(([name]) => name.endsWith(`.${format}`))![1],
            await readFile(
              join(dir, format === "wav" ? "master.wav" : "master.wav.mp3"),
            ),
          );
          assert.match(
            entries.get(`${folder}/release-info.txt`)!.toString(),
            /Included tracks: 1 of 2/,
          );
          assert.match(
            entries.get(`${folder}/release-info.txt`)!.toString(),
            /SEAAA2600001/,
          );
          assert.match(
            entries.get(`${folder}/release-info.txt`)!.toString(),
            format === "wav" ? /16 bit, 44100 Hz/ : /MP3: 320 kbps/,
          );
        }
      }
      const cachedMp3 = await stat(join(dir, "master.wav.mp3"));
      await (
        await assetAction(
          args(
            post({ email: "cached@example.test", format: "mp3" }),
            "download",
          ),
        )
      ).arrayBuffer();
      assert.equal(
        (await stat(join(dir, "master.wav.mp3"))).mtimeMs,
        cachedMp3.mtimeMs,
      );
      await db
        .update(releaseTracks)
        .set({ metadata: {} })
        .where(eq(releaseTracks.id, track));
      const fallback = await assetAction(
        args(post({ email: "fallback@example.test", track }), "download"),
      );
      assert.match(
        fallback.headers.get("content-disposition")!,
        /Martin%20Dice%20-%20Bl%C3%A5%20timmen/,
      );
      assert.ok(
        Buffer.from(await fallback.arrayBuffer()).includes(
          Buffer.from("03 - Martin Dice - Blå timmen.wav"),
        ),
      );
      const eventId = randomUUID();
      for (let i = 0; i < 2; i++)
        await assetAction(
          args(post({ kind: "play", track, eventId }), "events"),
        );
      await assetAction(
        args(
          post({ kind: "click", link: "0", eventId: randomUUID() }),
          "events",
        ),
      );
      await assetAction(
        args(post({ kind: "visit", eventId: randomUUID() }, session), "events"),
      );
      assert.equal(
        (
          await db
            .select()
            .from(releaseEvents)
            .where(
              and(
                eq(releaseEvents.releaseId, release),
                eq(releaseEvents.kind, "play"),
              ),
            )
        ).length,
        1,
      );
      const downloads = await db
        .select()
        .from(releaseEvents)
        .where(
          and(
            eq(releaseEvents.releaseId, release),
            eq(releaseEvents.kind, "download-started"),
          ),
        );
      assert.equal(downloads.length, 6);
      assert.equal(downloads[0].email, "not-verified@example.test");
      assert.equal(downloads[0].detail, "WAV\n3. Blå timmen");
      assert.equal(
        (
          await artistLoader({
            request: request(),
            params: { artist: `artist-${artist}` },
            context: new RouterContextProvider(),
            url: new URL(origin),
            pattern: "/",
          })
        ).releases.length,
        1,
      );
      // Revoke downloads while a request waits for the encoder's row lock.
      const blocker = await pool.connect();
      let waiting: Promise<unknown> | undefined;
      try {
        await blocker.query("BEGIN");
        await blocker.query(
          "SELECT id FROM release_tracks WHERE id = $1 FOR UPDATE",
          [track],
        );
        const {
          rows: [{ pid }],
        } = await blocker.query("SELECT pg_backend_pid() AS pid");
        waiting = assetAction(
          args(
            post({ email: "revoked@example.test", format: "mp3" }),
            "download",
          ),
        ).catch((e: unknown) => e);
        let blocked = false;
        for (let i = 0; i < 100 && !blocked; i++) {
          const { rows } = await pool.query(
            "SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          );
          blocked = rows[0].blocked;
          if (!blocked) await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.equal(blocked, true);
        await db
          .update(releases)
          .set({ audioEnabled: false })
          .where(eq(releases.id, release));
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
      }
      const revoked = await waiting;
      assert.ok(revoked instanceof Response && revoked.status === 403);
      await db
        .update(releases)
        .set({ audioEnabled: true })
        .where(eq(releases.id, release));
      await editAction({
        request: post({ intent: "remove-audio", track }, session),
        params: { id: release },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/",
      });
      await assert.rejects(stat(join(dir, "master.wav.mp3")), {
        code: "ENOENT",
      });
      await editAction({
        request: post({ intent: "unpublish" }, session),
        params: { id: release },
        context: new RouterContextProvider(),
        url: new URL(origin),
        pattern: "/",
      });
      await assert.rejects(assetLoader(args(ranged, "audio")), denied(404));
      await assert.rejects(
        assetLoader(args(request(), "artwork.jpg")),
        denied(404),
      );
      await assert.rejects(
        assetAction(args(post({ email: "valid@example.test" }), "download")),
        denied(404),
      );
      await db
        .update(releases)
        .set({ cover: null })
        .where(eq(releases.id, release));
      await assert.rejects(
        assetLoader(args(request(session), "artwork.jpg")),
        denied(404),
      );
      assert.equal((await page(session)).mediaArtwork, null);
    } finally {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
      await rm(dir, { recursive: true, force: true });
    }
  },
);

test("download filenames preserve readable Unicode and neutralize unsafe path and header characters", () => {
  assert.equal(
    downloadName("Åsa Öberg - Blå timmen"),
    "Åsa Öberg - Blå timmen",
  );
  assert.equal(downloadName("CON.txt"), "_CON.txt");
  assert.equal(downloadName(".."), "Download");
  assert.equal(downloadName("Music. "), "Music");
  const long = downloadName("Å".repeat(300));
  assert.ok(Buffer.byteLength(long) <= 200);
  assert.equal(long, "Å".repeat(100));
  const unsafe = downloadName('../A\\B: "Song"\r\n');
  assert.ok(!/[\/\\<>:"|?*\r\n]/.test(unsafe));
  assert.ok(!/[\r\n]/.test(zipDisposition(unsafe)));
  assert.match(
    zipDisposition(downloadName("Åsa - Blå")),
    /filename\*=UTF-8''%C3%85sa%20-%20Bl%C3%A5.zip/,
  );
});

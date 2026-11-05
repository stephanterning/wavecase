import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareHls, hlsToken } from "../app/server/hls";
import { measureAudio } from "../app/server/audio-measurements";
import { removeAudioFiles } from "../app/server/audio-files";
import { loader } from "../app/routes/hls";
import { hlsRedirect } from "../app/server/hls-access";

const exec = promisify(execFile);
test("HLS publishes normalized FLAC/AAC VOD, preserves samples across segments and removes capabilities with sources", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-hls-"));
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = directory;
  t.after(async () => {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  });
  const key = "private-original.wav";
  await exec("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=997:duration=5.123:sample_rate=48000",
    "-ac",
    "2",
    "-c:a",
    "pcm_s24le",
    join(directory, key),
  ]);
  const original = await readFile(join(directory, key));
  const [token, simultaneous] = await Promise.all([
    prepareHls(directory, key),
    prepareHls(directory, key),
  ]);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(token, simultaneous);
  assert.equal(await prepareHls(directory, key), token);
  const root = join(directory, "hls", token);
  assert.equal(await hlsToken(directory, key), token);
  assert.deepEqual(await readFile(join(directory, key)), original);
  const master = await readFile(join(root, "master.m3u8"), "utf8");
  assert.match(master, /CODECS="fLaC"/);
  assert.match(master, /CODECS="mp4a.40.2"/);
  assert.ok(!master.includes(key));
  const joined: Record<string, string> = {};
  for (const format of ["flac", "aac"]) {
    const playlist = await readFile(join(root, `${format}.m3u8`), "utf8");
    assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD/);
    assert.match(playlist, /#EXT-X-ENDLIST/);
    const segments = [
      ...playlist.matchAll(/#EXTINF:[\d.]+,\s*\n([^\n]+)/g),
    ].map((match) => match[1].trim());
    assert.ok(segments.length >= 3);
    joined[format] = `${format}-joined.mp4`;
    await writeFile(
      join(directory, joined[format]),
      Buffer.concat(
        await Promise.all(
          [`${format}-init.mp4`, ...segments].map((name) =>
            readFile(join(root, name)),
          ),
        ),
      ),
    );
    const { stdout } = await exec("ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-of",
      "json",
      join(directory, joined[format]),
    ]);
    const stream = JSON.parse(stdout).streams[0];
    assert.equal(stream.codec_name, format);
    assert.equal(stream.channels, 2);
    assert.equal(Number(stream.sample_rate), 48000);
    const measurements = await measureAudio(directory, joined[format]);
    assert.ok(measurements.peak! <= 0);
    assert.ok(measurements.truePeak! <= 0);
    assert.ok(Math.abs(measurements.lufs! + 16) < 0.2);
  }
  const decode = async (file: string) =>
    (
      await exec(
        "ffmpeg",
        ["-v", "error", "-i", join(directory, file), "-f", "f32le", "-"],
        { encoding: "buffer", maxBuffer: 8 * 1024 * 1024 },
      )
    ).stdout;
  const [input, output] = await Promise.all([decode(key), decode(joined.flac)]);
  assert.equal(
    output.length,
    input.length,
    "FLAC segmentation adds/drops no samples, including the partial last segment",
  );
  const gain =
    10 **
    (JSON.parse(await readFile(join(directory, `${key}.hls-v1.json`), "utf8"))
      .gainDb /
      20);
  let maxError = 0;
  for (let i = 0; i < input.length; i += 4)
    maxError = Math.max(
      maxError,
      Math.abs(output.readFloatLE(i) - input.readFloatLE(i) * gain),
    );
  assert.ok(
    maxError < 2e-7,
    `constant gain with 24-bit quantization, max error ${maxError}`,
  );
  const response = (
    file: string,
    headers?: Record<string, string>,
    method = "GET",
  ) =>
    loader({
      request: new Request(`https://test/hls/${token}/${file}`, {
        headers,
        method,
      }),
      params: { token, file },
      context: {},
    } as unknown as Parameters<typeof loader>[0]);
  const redirected = await hlsRedirect(
    new Request("https://test/media/123?hls=flac"),
    directory,
    key,
  );
  assert.equal(redirected?.headers.get("location"), `/hls/${token}/flac.m3u8`);
  const range = await response("flac-init.mp4", { Range: "bytes=0-15" });
  assert.equal(range.status, 206);
  assert.equal((await range.arrayBuffer()).byteLength, 16);
  assert.equal(
    (await response("flac-init.mp4", { Range: "bytes=0-15" }, "HEAD")).body,
    null,
  );
  assert.equal(
    (await response("flac-init.mp4", { Range: "bytes=-0" })).status,
    416,
  );
  await assert.rejects(
    response("../private-original.wav"),
    (error: unknown) => error instanceof Response && error.status === 404,
  );
  await removeAudioFiles(directory, [key]);
  assert.equal(await hlsToken(directory, key), null);
  await assert.rejects(
    response("flac.m3u8"),
    (error: unknown) => error instanceof Response && error.status === 404,
  );
  assert.deepEqual(
    await readdir(join(directory, "hls")).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    ),
    [],
  );
});

test("failed preparation exposes no capability and preserves the source for retry", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wavecase-hls-failure-"));
  try {
    const bytes = Buffer.from("not audio");
    await writeFile(join(directory, "broken.wav"), bytes);
    await assert.rejects(prepareHls(directory, "broken.wav"));
    assert.equal(await hlsToken(directory, "broken.wav"), null);
    assert.deepEqual(await readFile(join(directory, "broken.wav")), bytes);
    assert.deepEqual(
      await readdir(join(directory, "hls")).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return [];
          throw error;
        },
      ),
      [],
    );
    await assert.rejects(
      hlsRedirect(
        new Request("https://test/media/123?hls=flac"),
        directory,
        "broken.wav",
      ),
      (error: unknown) => error instanceof Response && error.status === 503,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

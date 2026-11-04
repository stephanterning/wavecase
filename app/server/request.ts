import busboy from "busboy";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { dataDir } from "./config";
import { temporary } from "./storage-keys";
const tooLarge = () => new Response("Request too large", { status: 413 });
export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit) throw tooLarge();
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value);
    }
  }
  return new Response(Buffer.concat(chunks), {
    headers: {
      "Content-Type":
        request.headers.get("content-type") || "application/octet-stream",
    },
  });
}

export type Upload = { key: string; name: string; size: number };
const received = (key: string) => join(dataDir(), temporary(key));
// Oversized bodies are read to the end and discarded, because browsers report
// a network error instead of the response when the upload is cut off. Call
// discard() when the action finishes; it removes uploads that storeUpload did
// not keep.
export async function uploadForm(request: Request, limit: number) {
  const parser = busboy({
    headers: { "content-type": request.headers.get("content-type") ?? "" },
    defParamCharset: "utf8",
    limits: { fieldSize: 65536 },
  });
  await mkdir(dataDir(), { recursive: true });
  const form = new FormData();
  const files = new Map<string, Upload>();
  const writes: Promise<void>[] = [];
  let exceeded = false;
  let failure: unknown;
  parser.on("field", (name, value, info) => {
    if (info.valueTruncated) exceeded = true;
    else form.append(name, value);
  });
  parser.on("file", (name, stream, info) => {
    if (files.has(name)) return void stream.resume();
    const upload = { key: randomUUID(), name: info.filename || "", size: 0 };
    const output = createWriteStream(received(upload.key));
    files.set(name, upload);
    writes.push(
      pipeline(stream, output).then(
        () => void (upload.size = output.bytesWritten),
        (error) => {
          failure ??= error;
          parser.destroy(error);
        },
      ),
    );
  });
  const discard = async () => {
    await Promise.all(
      [...files.values()].map((file) =>
        unlink(received(file.key)).catch(() => {}),
      ),
    );
  };
  let size = 0;
  try {
    await pipeline(
      request.body
        ? Readable.fromWeb(request.body as ReadableStream<Uint8Array>)
        : Readable.from([]),
      async function* (chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          size += chunk.length;
          if (size > limit) exceeded = true;
          if (!exceeded) yield chunk;
        }
      },
      parser,
    );
    await Promise.all(writes);
    if (exceeded) throw tooLarge();
    if (failure) throw failure;
  } catch (error) {
    await Promise.all(writes);
    await discard();
    throw exceeded ? tooLarge() : error;
  }
  return { form, files, discard };
}
export async function storeUpload(
  file: Upload,
  {
    limit,
    error = "Choose a file within the upload size limit.",
  }: { limit: number; error?: string },
) {
  if (!file.size || file.size > limit)
    throw new Response(error, { status: 400 });
  await rename(received(file.key), join(dataDir(), file.key));
  return file.key;
}

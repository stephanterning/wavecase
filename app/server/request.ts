export async function limitedBody(request: Request, limit: number) {
  if (Number(request.headers.get("content-length")) > limit)
    throw new Response("Request too large", { status: 413 });
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
        throw new Response("Request too large", { status: 413 });
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

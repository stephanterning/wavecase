export const compressedCacheBytes = 96_000_000;

type Entry = { source: string; bytes: ArrayBuffer };

/** One byte-bounded LRU for the tab's listening session. Buffers belong to the
 * cache; decoders must receive a copy because Web Audio detaches its input. */
export class CompressedAudioCache {
  private entries = new Map<string, Entry>();
  private bytes = 0;
  generation = 0;
  constructor(private limit = compressedCacheBytes) {}
  get byteLength() {
    return this.bytes;
  }
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.bytes;
  }
  put(key: string, source: string, bytes: ArrayBuffer, generation: number) {
    if (
      generation !== this.generation ||
      !bytes.byteLength ||
      bytes.byteLength > this.limit
    )
      return;
    const previous = this.entries.get(key);
    if (previous) this.bytes -= previous.bytes.byteLength;
    this.entries.delete(key);
    this.entries.set(key, { source, bytes });
    this.bytes += bytes.byteLength;
    // Also bound bookkeeping for highly compressed silence.
    while (this.bytes > this.limit || this.entries.size > 4096)
      this.remove(this.entries.keys().next().value!);
  }
  private remove(key: string) {
    this.bytes -= this.entries.get(key)!.bytes.byteLength;
    this.entries.delete(key);
  }
  forget(source: string) {
    ++this.generation;
    for (const [key, entry] of this.entries)
      if (entry.source === source) this.remove(key);
  }
  clear = () => {
    ++this.generation;
    this.entries.clear();
    this.bytes = 0;
  };
}

export const compressedAudioCache = new CompressedAudioCache();

/** Called by each playback scope, not by individual track/version transports. */
export function attachAudioCacheSession() {
  window.addEventListener("pagehide", compressedAudioCache.clear);
  window.addEventListener(
    "wavecase-access-revoked",
    compressedAudioCache.clear,
  );
  return () => {
    window.removeEventListener("pagehide", compressedAudioCache.clear);
    window.removeEventListener(
      "wavecase-access-revoked",
      compressedAudioCache.clear,
    );
    compressedAudioCache.clear();
  };
}

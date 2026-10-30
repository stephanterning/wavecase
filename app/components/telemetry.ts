import { referrerWebsite } from "../domain/referrer";

export function browserIdentity() {
  let id = localStorage.getItem("wavecase.browser");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("wavecase.browser", id);
  }
  return id;
}

export function listenerIdentity(share: string) {
  const key = "wavecase.session." + share;
  let previous: { id: string; time: number; referrer?: string | null } | null =
    null;
  try {
    previous = JSON.parse(sessionStorage.getItem(key) || "null");
  } catch {
    /* A cleared or incompatible session starts fresh. */
  }
  const fresh = !previous || Date.now() - previous.time >= 30 * 60000;
  const session = {
    id: fresh ? crypto.randomUUID() : previous!.id,
    time: Date.now(),
    referrer: fresh
      ? referrerWebsite(
          typeof document === "undefined" ? null : document.referrer,
          window.location.origin,
        )
      : previous!.referrer || null,
  };
  sessionStorage.setItem(key, JSON.stringify(session));
  return {
    browser: browserIdentity(),
    session: session.id,
    referrer: session.referrer,
    name: localStorage.getItem("wavecase.name"),
  };
}

// Retry temporary failures while this page is alive. Stable event IDs make retries
// safe even when the server accepted an event but its response was lost.
async function deliver(url: string, body: string) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body,
    });
    if (response.ok) return;
    if (
      response.status < 500 &&
      response.status !== 429 &&
      response.status !== 408
    ) {
      console.warn("Wavecase activity was rejected", response.status);
      return;
    }
  } catch {
    /* Preserve this event for another attempt. */
  }
  setTimeout(() => void deliver(url, body), 10000);
}

let lastEventTime = 0;
export function recordEvent(
  share: string,
  versionId: string | null,
  kind: string,
  position = 0,
  end?: number,
) {
  lastEventTime = Math.max(Date.now(), lastEventTime + 1);
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    ...listenerIdentity(share),
    occurredAt: new Date(lastEventTime).toISOString(),
    kind,
    position,
    end,
  });
  void deliver(
    versionId ? "/events/" + versionId + "?share=" + share : "/visits/" + share,
    body,
  );
}

export function recordVisit(share: string) {
  recordEvent(share, null, "visit");
}

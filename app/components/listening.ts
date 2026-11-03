import { recordEvent } from "./telemetry";
export function observeListening(
  audio: HTMLAudioElement,
  versionId: string,
  share: string,
  versionChanged = false,
) {
  let started = false,
    last = audio.currentTime,
    start = last,
    lastWall = performance.now();
  function send(kind: string, position = audio.currentTime, end?: number) {
    recordEvent(share, versionId, kind, position, end);
  }
  function flush() {
    while (last > start) {
      const end = Math.min(last, start + 30);
      send("interval", start, end);
      start = end;
    }
    start = last;
  }
  function observe() {
    if (audio.seeking) return;
    const current = audio.currentTime;
    const elapsed = (performance.now() - lastWall) / 1000;
    const distance = current - last;
    if (distance < 0 || distance > elapsed * audio.playbackRate + 0.25) {
      flush();
      start = current;
    } else if (distance > 0 && !started && !audio.paused) {
      send("play", last);
      started = true;
    }
    last = current;
    lastWall = performance.now();
  }
  function playing() {
    flush();
    if (!started) {
      send("play");
      started = true;
    }
    start = last = audio.currentTime;
    lastWall = performance.now();
  }
  function seeking() {
    flush();
    // Restoring a version's position can dispatch a queued seeking event after
    // observation starts. It is not a user seek from the restored baseline.
    if (last !== audio.currentTime) send("seek", last, audio.currentTime);
    start = last = audio.currentTime;
    lastWall = performance.now();
  }
  function seeked() {
    start = last = audio.currentTime;
    lastWall = performance.now();
  }
  function pause() {
    observe();
    flush();
    send("pause");
  }
  function ended() {
    observe();
    flush();
    send("ended");
    started = false;
  }
  function loop() {
    // The native loop has already wrapped. Close the old interval at the real
    // end before observing the new position; this is not a user seek.
    last = audio.duration;
    flush();
    send("ended", audio.duration);
    started = false;
    start = last = audio.currentTime;
    lastWall = performance.now();
    if (!audio.seeking) playing();
  }
  function tick() {
    if (!audio.paused && !audio.seeking) {
      observe();
      flush();
    }
  }
  const listeners = {
    playing,
    seeking,
    seeked,
    pause,
    ended,
    timeupdate: observe,
    "wavecase-loop": loop,
  };
  if (versionChanged) send("version-changed");
  for (const [name, listener] of Object.entries(listeners))
    audio.addEventListener(name, listener);
  // A prepared version becomes audible after its native playing event.
  if (!audio.paused && audio.readyState >= 3) playing();
  const timer = setInterval(tick, 2000);
  window.addEventListener("pagehide", flush);
  return () => {
    observe();
    flush();
    clearInterval(timer);
    window.removeEventListener("pagehide", flush);
    for (const [name, listener] of Object.entries(listeners))
      audio.removeEventListener(name, listener);
  };
}

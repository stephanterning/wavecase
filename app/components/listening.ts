import { recordEvent } from "./telemetry";
export function observeListening(
  audio: HTMLAudioElement,
  versionId: string,
  share: string,
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
    send("seek", last, audio.currentTime);
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
  };
  for (const [name, listener] of Object.entries(listeners))
    audio.addEventListener(name, listener);
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

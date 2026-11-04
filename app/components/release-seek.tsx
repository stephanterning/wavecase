import { useEffect, useRef, useState } from "react";

const time = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

export function ReleaseSeek({
  position,
  duration,
  onSeek,
}: {
  position: number;
  duration: number;
  onSeek: (position: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<number | null>(null);
  function cancel() {
    pending.current = null;
    setPreview(null);
  }
  useEffect(() => {
    const slider = input.current!;
    const commit = () => {
      const next = pending.current;
      if (next === null) return;
      pending.current = null;
      onSeek(next);
      setPreview(null);
    };
    const release = (event: PointerEvent) => {
      if (event.isPrimary) commit();
    };
    // React's onChange fires while dragging; native change commits the gesture,
    // including release outside the control and keyboard input. WebKit touch
    // input can omit change, so pointerup also commits the same pending value.
    slider.addEventListener("change", commit);
    slider.addEventListener("pointerup", release);
    return () => {
      slider.removeEventListener("change", commit);
      slider.removeEventListener("pointerup", release);
    };
  }, [onSeek]);
  return (
    <label className="release-seek">
      {time(preview ?? position)} / {time(duration)}
      <input
        ref={input}
        aria-label="Playback position"
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={preview ?? position}
        onChange={(event) => {
          const next = event.currentTarget.valueAsNumber;
          if (event.nativeEvent.type === "input") {
            pending.current = next;
            setPreview(next);
          } else {
            // Assistive changes can commit without a preceding input event.
            onSeek(next);
          }
        }}
        onPointerCancel={cancel}
        onBlur={cancel}
      />
    </label>
  );
}

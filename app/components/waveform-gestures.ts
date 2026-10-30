export type CommentSelection = { start: number | null; end: number | null };
export function selectedTimes(
  start: number,
  end: number,
  dragged: boolean,
): CommentSelection {
  const round = (time: number) => Math.floor(Math.max(0, time) * 100) / 100;
  return {
    start: round(dragged ? Math.min(start, end) : start),
    end: dragged ? round(Math.max(start, end)) : null,
  };
}
export interface WaveformViewport {
  getWrapper(): HTMLElement;
  getWidth(): number;
  getScroll(): number;
  setScroll(pixels: number): void;
  zoom(pixelsPerSecond: number): void;
}

/** Pointer gestures share one coordinate system, including after zoom and pan. */
export function attachWaveformGestures(
  element: HTMLElement,
  wave: WaveformViewport,
  media: HTMLAudioElement,
  duration: number,
  onComment?: (selection: CommentSelection) => void,
) {
  const overlay = document.createElement("div");
  overlay.className = "waveform-selection";
  overlay.hidden = true;
  overlay.setAttribute("aria-hidden", "true");
  element.append(overlay);
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: {
    id: number;
    x: number;
    y: number;
    lastX: number;
    time: number;
    kind: "tap" | "pan" | "select";
  } | null = null;
  let hold: ReturnType<typeof setTimeout> | undefined;
  let pinching = false,
    distance = 0,
    pinchCenter = 0;
  const cancelHold = () => {
    clearTimeout(hold);
    hold = undefined;
  };
  const timeAt = (x: number) => {
    const bounds = wave.getWrapper().getBoundingClientRect();
    return Math.max(
      0,
      Math.min(
        duration,
        ((x - bounds.left) / Math.max(1, bounds.width)) * duration,
      ),
    );
  };
  const draw = (x: number) => {
    if (!gesture) return;
    const bounds = element.getBoundingClientRect();
    const start = Math.max(0, Math.min(bounds.width, gesture.x - bounds.left));
    const end = Math.max(0, Math.min(bounds.width, x - bounds.left));
    overlay.hidden = false;
    overlay.style.left = Math.min(start, end) + "px";
    overlay.style.width = Math.max(2, Math.abs(end - start)) + "px";
  };
  const zoom = (factor: number, anchor: number, previousAnchor = anchor) => {
    if (!duration) return;
    const viewport = wave.getWidth();
    const width = wave.getWrapper().getBoundingClientRect().width;
    const time = timeAt(previousAnchor);
    const offset = anchor - element.getBoundingClientRect().left;
    const next = Math.max(viewport, Math.min(viewport * 32, width * factor));
    wave.zoom(next / duration);
    wave.setScroll(Math.max(0, (time / duration) * next - offset));
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    if (gesture || pinching) return;
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY) && !event.ctrlKey)
      wave.setScroll(wave.getScroll() + event.deltaX);
    else
      zoom(
        Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.04 : 0.003)),
        event.clientX,
      );
  };
  const down = (event: PointerEvent) => {
    // Leave the native horizontal scrollbar available when zoomed in.
    if (event.clientY > wave.getWrapper().getBoundingClientRect().bottom)
      return;
    if (
      event.pointerType !== "touch" &&
      event.button !== 0 &&
      event.button !== 2
    )
      return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    element.setPointerCapture(event.pointerId);
    cancelHold();
    if (pointers.size > 1) {
      gesture = null;
      overlay.hidden = true;
      pinching = true;
      const [a, b] = [...pointers.values()];
      distance = Math.hypot(a.x - b.x, a.y - b.y);
      pinchCenter = (a.x + b.x) / 2;
      return;
    }
    if (pinching) return;
    gesture = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      lastX: event.clientX,
      time: timeAt(event.clientX),
      kind:
        (event.button === 2 || event.ctrlKey) && onComment ? "select" : "tap",
    };
    if (gesture.kind === "select") {
      event.preventDefault();
      element.focus({ preventScroll: true });
      draw(event.clientX);
    }
    if (event.pointerType === "touch" && onComment)
      hold = setTimeout(() => {
        if (gesture && pointers.size === 1) {
          gesture.kind = "select";
          draw(gesture.x);
        }
      }, 500);
  };
  const move = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinching) {
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const next = Math.hypot(a.x - b.x, a.y - b.y);
        const center = (a.x + b.x) / 2;
        if (distance > 0) zoom(next / distance, center, pinchCenter);
        distance = next;
        pinchCenter = center;
      }
      return;
    }
    if (!gesture || gesture.id !== event.pointerId) return;
    if (gesture.kind === "select") {
      draw(event.clientX);
      return;
    }
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 6) {
      cancelHold();
      gesture.kind = "pan";
    }
    if (gesture.kind === "pan")
      wave.setScroll(wave.getScroll() + gesture.lastX - event.clientX);
    gesture.lastX = event.clientX;
  };
  const up = (event: PointerEvent) => {
    cancelHold();
    pointers.delete(event.pointerId);
    if (pinching) {
      if (!pointers.size) pinching = false;
      return;
    }
    const finished = gesture;
    gesture = null;
    overlay.hidden = true;
    if (!finished || finished.id !== event.pointerId) return;
    if (finished.kind === "select")
      onComment?.(
        selectedTimes(
          finished.time,
          timeAt(event.clientX),
          Math.abs(event.clientX - finished.x) >= 5,
        ),
      );
    else if (finished.kind === "tap" && event.button !== 2)
      media.currentTime = timeAt(event.clientX);
  };
  const cancel = () => {
    cancelHold();
    gesture = null;
    pointers.clear();
    pinching = false;
    overlay.hidden = true;
  };
  const context = (event: MouseEvent) => event.preventDefault();
  const keyboard = (event: KeyboardEvent) => {
    if (
      event.key === "ContextMenu" ||
      (event.shiftKey && event.key === "F10")
    ) {
      if (onComment) {
        event.preventDefault();
        onComment(selectedTimes(media.currentTime, media.currentTime, false));
      }
    } else if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      media.currentTime =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? duration
            : Math.max(
                0,
                Math.min(
                  duration,
                  media.currentTime + (event.key === "ArrowRight" ? 5 : -5),
                ),
              );
    } else if (["+", "=", "-"].includes(event.key)) {
      event.preventDefault();
      const bounds = element.getBoundingClientRect();
      zoom(event.key === "-" ? 0.8 : 1.25, bounds.left + bounds.width / 2);
    }
  };
  element.addEventListener("wheel", wheel, { passive: false });
  element.addEventListener("pointerdown", down);
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", up);
  element.addEventListener("pointercancel", cancel);
  element.addEventListener("contextmenu", context);
  element.addEventListener("keydown", keyboard);
  return () => {
    cancel();
    overlay.remove();
    element.removeEventListener("wheel", wheel);
    element.removeEventListener("pointerdown", down);
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", up);
    element.removeEventListener("pointercancel", cancel);
    element.removeEventListener("contextmenu", context);
    element.removeEventListener("keydown", keyboard);
  };
}

import { ref, type Ref } from "vue";

export interface DragState {
  /** 相對於拖曳起點的位移。 */
  dx: number;
  dy: number;
  /** 目前指標位置（client 座標）。 */
  x: number;
  y: number;
  /** 放手瞬間的速度（px/s）；拖曳中為即時速度。 */
  velocityX: number;
  velocityY: number;
  event: PointerEvent;
}

interface Sample {
  time: number;
  x: number;
  y: number;
}

/** 速度取樣視窗：只看最近 100ms，才反映「放手那一刻」的速度。 */
const SAMPLE_WINDOW_MS = 100;

export interface DragHandlers {
  onStart?: (state: DragState) => void;
  onMove: (state: DragState) => void;
  onEnd: (state: DragState) => void;
}

/**
 * 通用拖曳手勢：Pointer Events + `setPointerCapture`，並記錄速度。
 *
 * 手指離開元素範圍仍然持續追蹤，這是 1:1 跟手的必要條件；
 * 速度則交給彈簧做 velocity handoff。
 */
export function useDragGesture(handlers: DragHandlers) {
  const dragging: Ref<boolean> = ref(false);
  let samples: Sample[] = [];
  let origin = { x: 0, y: 0 };
  let pointerId = -1;

  function build(event: PointerEvent): DragState {
    const now = performance.now();
    samples.push({ time: now, x: event.clientX, y: event.clientY });
    const cutoff = now - SAMPLE_WINDOW_MS;
    samples = samples.filter((sample) => sample.time >= cutoff);

    const first = samples[0];
    const last = samples[samples.length - 1];
    const span = Math.max(last.time - first.time, 1) / 1000;

    return {
      dx: event.clientX - origin.x,
      dy: event.clientY - origin.y,
      x: event.clientX,
      y: event.clientY,
      velocityX: (last.x - first.x) / span,
      velocityY: (last.y - first.y) / span,
      event,
    };
  }

  function onPointerMove(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== pointerId) {
      return;
    }
    handlers.onMove(build(event));
  }

  function finish(event: PointerEvent) {
    if (!dragging.value || event.pointerId !== pointerId) {
      return;
    }
    const state = build(event);
    dragging.value = false;
    detach();
    handlers.onEnd(state);
  }

  function detach() {
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
  }

  function onPointerDown(event: PointerEvent) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    pointerId = event.pointerId;
    origin = { x: event.clientX, y: event.clientY };
    samples = [];
    dragging.value = true;

    const target = event.currentTarget;
    if (target instanceof Element) {
      target.setPointerCapture(event.pointerId);
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    handlers.onStart?.(build(event));
  }

  return { dragging, onPointerDown };
}

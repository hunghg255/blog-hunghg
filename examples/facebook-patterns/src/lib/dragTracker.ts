/**
 * Kéo bằng con trỏ, gom delta theo khung hình (ý tưởng từ DOMMouseMoveTracker của Facebook):
 * mỗi pointermove chỉ CỘNG DỒN dx/dy, handler thật chạy tối đa một lần mỗi frame với tổng delta.
 * Khác bản gốc: dùng Pointer Events + pointer capture (chuột, cảm ứng, bút), xả delta còn treo
 * khi thả, và có cancel() để huỷ giữa chừng.
 */

export interface DragTrackerOptions {
  /** gọi tối đa 1 lần/frame với tổng dịch chuyển kể từ lần gọi trước */
  onMove: (dx: number, dy: number) => void;
  onEnd?: (cancelled: boolean) => void;
  /** đổi để test: mặc định requestAnimationFrame */
  schedule?: (cb: () => void) => number;
  cancelSchedule?: (id: number) => void;
}

export interface DragTracker {
  start(event: PointerEvent): void;
  cancel(): void;
  readonly dragging: boolean;
  /** số pointermove đã nhận và số lần onMove thực sự chạy, để so sánh */
  readonly stats: { events: number; flushes: number };
}

export function createDragTracker(target: HTMLElement, options: DragTrackerOptions): DragTracker {
  const schedule = options.schedule ?? ((cb) => requestAnimationFrame(cb));
  const cancelSchedule = options.cancelSchedule ?? ((id) => cancelAnimationFrame(id));
  let dragging = false;
  let pointerId = -1;
  let lastX = 0;
  let lastY = 0;
  let dx = 0;
  let dy = 0;
  let frame: number | null = null;
  const stats = { events: 0, flushes: 0 };

  const flush = () => {
    frame = null;
    if (dx === 0 && dy === 0) return;
    stats.flushes++;
    const x = dx;
    const y = dy;
    dx = dy = 0;
    options.onMove(x, y);
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    stats.events++;
    dx += event.clientX - lastX;
    dy += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (frame === null) frame = schedule(flush);
  };

  const stop = (cancelled: boolean) => {
    if (!dragging) return;
    if (frame !== null) cancelSchedule(frame);
    if (!cancelled) flush(); // xả delta cuối, không để "hụt" vài pixel khi thả
    frame = null;
    dx = dy = 0;
    dragging = false;
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onCancel);
    if (target.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
    options.onEnd?.(cancelled);
  };
  const onUp = (event: PointerEvent) => event.pointerId === pointerId && stop(false);
  const onCancel = (event: PointerEvent) => event.pointerId === pointerId && stop(true);

  return {
    get dragging() {
      return dragging;
    },
    stats,
    start(event) {
      if (dragging) return;
      dragging = true;
      pointerId = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
      dx = dy = 0;
      // capture: vẫn nhận move/up khi con trỏ ra khỏi phần tử (thay cho nghe trên document)
      target.setPointerCapture?.(pointerId);
      target.addEventListener('pointermove', onMove);
      target.addEventListener('pointerup', onUp);
      target.addEventListener('pointercancel', onCancel);
      event.preventDefault();
    },
    cancel: () => stop(true),
  };
}

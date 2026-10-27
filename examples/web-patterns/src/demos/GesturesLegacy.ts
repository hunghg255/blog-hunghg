/**
 * Mô phỏng hành vi của captureEvents.ts bản gốc (Telegram Web) để so sánh trong demo:
 * nghe mousedown + touchstart riêng, gắn move/up lên document, gọi onSwipe ở MỖI lần
 * di chuyển sau khi đã khoá trục, gọi onClick khi thả tay mà chưa di chuyển 15px.
 * Viết lại gọn, không phải mã nguồn gốc.
 */
type Dir = 'left' | 'right' | 'up' | 'down';
interface LegacyOptions {
  onSwipe?: (dir: Dir) => void;
  onClick?: (source: string) => void;
  onDrag?: (dx: number, dy: number) => void;
  onRelease?: () => void;
}

const point = (e: MouseEvent | TouchEvent) =>
  'touches' in e ? (e.touches[0] ?? e.changedTouches[0]) : e;

export function legacyCaptureEvents(element: HTMLElement, options: LegacyOptions) {
  let start: { x: number; y: number } | null = null;
  let moved = false;
  let axis: 'x' | 'y' | undefined;

  const onMove = (e: MouseEvent | TouchEvent) => {
    if (!start) return;
    const p = point(e);
    const dx = p.pageX - start.x;
    const dy = p.pageY - start.y;
    if (Math.abs(dx) >= 15 || Math.abs(dy) >= 15) moved = true;
    options.onDrag?.(dx, dy);
    if (!axis) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (dx && dy && Math.max(ax, ay) / Math.min(ax, ay) < 2) return; // chéo
      if (ax >= 50) axis = 'x';
      else if (ay >= 50) axis = 'y';
    }
    // giống bản gốc: đã có trục thì mỗi lần move đều gọi onSwipe
    if (axis === 'x') options.onSwipe?.(dx < 0 ? 'left' : 'right');
    else if (axis === 'y') options.onSwipe?.(dy < 0 ? 'up' : 'down');
  };

  const onRelease = (e: MouseEvent | TouchEvent) => {
    if (!start) return;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onRelease);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onRelease);
    document.removeEventListener('touchcancel', onRelease);
    start = null;
    if (moved) options.onRelease?.();
    else if (!('button' in e) || e.button === 0) options.onClick?.(e.type);
    moved = false;
    axis = undefined;
  };

  const onCapture = (e: MouseEvent | TouchEvent) => {
    const p = point(e);
    start = { x: p.pageX, y: p.pageY };
    if (e.type === 'mousedown') {
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onRelease);
    } else {
      document.addEventListener('touchmove', onMove);
      document.addEventListener('touchend', onRelease);
      document.addEventListener('touchcancel', onRelease);
    }
  };

  element.addEventListener('mousedown', onCapture);
  element.addEventListener('touchstart', onCapture, { passive: true });
  return () => {
    element.removeEventListener('mousedown', onCapture);
    element.removeEventListener('touchstart', onCapture);
  };
}

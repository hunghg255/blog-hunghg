/**
 * Kéo, vuốt, bấm dùng chung cho chuột, cảm ứng và bút (ý tưởng từ util/captureEvents.ts của
 * Telegram Web), viết lại bằng Pointer Events + setPointerCapture:
 * - phân biệt bấm và kéo bằng ngưỡng di chuyển (Telegram: 15px),
 * - vuốt khi đi đủ xa theo một trục (Telegram: 50px), bỏ qua vuốt chéo (tỉ lệ 2 trục < 2),
 * - khoá trục sau khi đã xác định để cử chỉ không "trôi" sang trục kia.
 */

export type SwipeDirection = 'left' | 'right' | 'up' | 'down';
export type Axis = 'x' | 'y';

export interface DragInfo {
  dx: number;
  dy: number;
  /** trục đã khoá (undefined khi chưa đủ xa hoặc đang đi chéo) */
  axis?: Axis;
}

export interface GestureOptions {
  /** trục được phép vuốt. 'x': trình duyệt vẫn tự cuộn dọc (touch-action: pan-y) */
  axis?: Axis | 'both';
  /** di chuyển ít hơn chừng này px thì vẫn tính là bấm */
  movedThreshold?: number;
  /** đi xa chừng này px theo trục đã khoá thì tính là vuốt */
  swipeThreshold?: number;
  /** trục dài phải gấp ít nhất chừng này lần trục ngắn, nếu không coi là vuốt chéo */
  diagonalRatio?: number;
  /** bỏ qua cử chỉ bắt đầu trong các phần tử khớp selector (nút, thanh điều khiển…) */
  exclude?: string;
  onStart?: (e: PointerEvent) => void;
  onDrag?: (e: PointerEvent, info: DragInfo) => void;
  /** gọi MỘT lần cho mỗi cử chỉ (bản Telegram gọi lại ở mỗi lần di chuyển) */
  onSwipe?: (direction: SwipeDirection, e: PointerEvent) => void;
  /** thả tay sau khi đã kéo */
  onRelease?: (e: PointerEvent, info: DragInfo) => void;
  /** bấm (không kéo) bằng nút chính */
  onClick?: (e: PointerEvent) => void;
}

export function captureGestures(element: HTMLElement, options: GestureOptions): () => void {
  const { axis: allowed = 'both', movedThreshold = 15, swipeThreshold = 50, diagonalRatio = 2 } = options;

  // Không có touch-action thì trên màn cảm ứng trình duyệt sẽ giành cử chỉ để cuộn/zoom và
  // phát pointercancel giữa chừng. Chỉ nhường lại trục mà ta KHÔNG xử lý.
  const previousTouchAction = element.style.touchAction;
  element.style.touchAction = allowed === 'x' ? 'pan-y' : allowed === 'y' ? 'pan-x' : 'none';

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let moved = false;
  let lockedAxis: Axis | undefined;
  let swiped = false;
  let gesture: AbortController | null = null;

  const end = () => {
    gesture?.abort(); // gỡ hết listener của cử chỉ hiện tại trong một lần
    gesture = null;
    pointerId = null;
    document.body.classList.remove('no-selection');
  };

  const decideAxis = (dx: number, dy: number): Axis | undefined => {
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (ax && ay && Math.max(ax, ay) / Math.min(ax, ay) < diagonalRatio) return undefined; // vuốt chéo
    if (ax >= movedThreshold && ax > ay) return 'x';
    if (ay >= movedThreshold && ay > ax) return 'y';
    return undefined;
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!moved && (Math.abs(dx) >= movedThreshold || Math.abs(dy) >= movedThreshold)) moved = true;
    lockedAxis ??= decideAxis(dx, dy);
    options.onDrag?.(e, { dx, dy, axis: lockedAxis });

    if (swiped || !lockedAxis || !options.onSwipe) return;
    if (allowed !== 'both' && lockedAxis !== allowed) return;
    const offset = lockedAxis === 'x' ? dx : dy;
    if (Math.abs(offset) < swipeThreshold) return;
    swiped = true;
    options.onSwipe(lockedAxis === 'x' ? (offset < 0 ? 'left' : 'right') : offset < 0 ? 'up' : 'down', e);
  };

  const onUp = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    const info = { dx: e.clientX - startX, dy: e.clientY - startY, axis: lockedAxis };
    const wasMoved = moved;
    end();
    if (wasMoved) {
      options.onRelease?.(e, info);
      // trình duyệt vẫn phát `click` sau khi kéo nếu nhấn và thả trên cùng phần tử:
      // chặn đúng một click đó để link/nút bên trong không bị kích hoạt nhầm
      const swallow = (click: MouseEvent) => {
        click.preventDefault();
        click.stopPropagation();
      };
      element.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => element.removeEventListener('click', swallow, { capture: true }), 0);
    } else {
      options.onClick?.(e);
    }
  };

  const onCancel = (e: PointerEvent) => {
    // trình duyệt giành cử chỉ (cuộn trang, zoom) hoặc mất capture: huỷ, không coi là bấm
    if (e.pointerId === pointerId) end();
  };

  const onDown = (e: PointerEvent) => {
    if (!e.isPrimary || pointerId !== null) return; // bỏ ngón thứ hai, chuột phải…
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (options.exclude && (e.target as Element).closest(options.exclude)) return;

    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    swiped = false;
    lockedAxis = undefined;
    // mọi pointermove/pointerup sau đó đều về element này, kể cả khi con trỏ đã ra ngoài
    // (thay cho việc gắn listener lên document như bản gốc)
    element.setPointerCapture(e.pointerId);
    gesture = new AbortController();
    const signal = gesture.signal;
    element.addEventListener('pointermove', onMove, { signal });
    element.addEventListener('pointerup', onUp, { signal });
    element.addEventListener('pointercancel', onCancel, { signal });
    element.addEventListener('lostpointercapture', onCancel, { signal });
    document.body.classList.add('no-selection');
    options.onStart?.(e);
  };

  element.addEventListener('pointerdown', onDown);
  return () => {
    element.removeEventListener('pointerdown', onDown);
    end(); // khác bản gốc: huỷ luôn cử chỉ đang dở khi component unmount
    element.style.touchAction = previousTouchAction;
  };
}

/**
 * Kéo cạnh để đổi kích thước một khối, và làm mờ mép của một hàng cuộn ngang
 * (ý tưởng từ Resizer và GradientScroll của Udemy).
 *
 * Khác bản gốc:
 * - Dùng Pointer Events + setPointerCapture thay cho mousemove/touchmove gắn sẵn trên document:
 *   kéo qua iframe hay ra ngoài cửa sổ vẫn nhận được sự kiện, và chỉ nghe khi đang kéo.
 * - Tính kích thước từ vị trí BẮT ĐẦU kéo (delta), nên kéo cạnh trái/trên vẫn đúng
 *   dù khối được neo bên trái hay bên phải.
 * - Chỉ chặn hành vi mặc định khi nhấn đúng vào mép, nên chọn chữ bên trong vẫn được.
 */

export type Edge = 'top' | 'right' | 'bottom' | 'left';

export interface EdgeHit {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export const NO_EDGE: EdgeHit = { top: false, right: false, bottom: false, left: false };

export interface Box {
  width: number;
  height: number;
}

/** Con trỏ (x, y tính từ góc trên trái của khối) có đang nằm trên mép nào không. */
export function edgeAt(
  box: Box,
  x: number,
  y: number,
  margin: number,
  enabled: Partial<Record<Edge, boolean>>,
): EdgeHit {
  return {
    top: !!enabled.top && y >= 0 && y < margin,
    left: !!enabled.left && x >= 0 && x < margin,
    right: !!enabled.right && x <= box.width && x >= box.width - margin,
    bottom: !!enabled.bottom && y <= box.height && y >= box.height - margin,
  };
}

export const hasEdge = (hit: EdgeHit) => hit.top || hit.right || hit.bottom || hit.left;

/** Con trỏ chuột phù hợp với tổ hợp mép đang kéo. */
export function cursorFor(hit: EdgeHit): string {
  const vertical = hit.top || hit.bottom;
  const horizontal = hit.left || hit.right;
  if (vertical && horizontal) {
    // góc trên-trái và dưới-phải cùng một hướng chéo, hai góc còn lại hướng kia
    return (hit.top && hit.left) || (hit.bottom && hit.right) ? 'nwse-resize' : 'nesw-resize';
  }
  if (vertical) return 'ns-resize';
  if (horizontal) return 'ew-resize';
  return '';
}

export interface SizeLimits {
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

const clamp = (value: number, min = -Infinity, max = Infinity) => Math.min(max, Math.max(min, value));

/**
 * Kích thước mới tính từ kích thước lúc bắt đầu kéo và quãng con trỏ đã đi.
 * Kéo mép trái sang trái (dx < 0) thì rộng ra, mép phải sang phải (dx > 0) thì rộng ra.
 */
export function computeSize(start: Box, dx: number, dy: number, hit: EdgeHit, limits: SizeLimits = {}): Box {
  let { width, height } = start;
  if (hit.left) width = start.width - dx;
  else if (hit.right) width = start.width + dx;
  if (hit.top) height = start.height - dy;
  else if (hit.bottom) height = start.height + dy;
  return {
    width: clamp(width, limits.minWidth, limits.maxWidth),
    height: clamp(height, limits.minHeight, limits.maxHeight),
  };
}

export interface ResizerOptions extends SizeLimits {
  edges: Partial<Record<Edge, boolean>>;
  /** Vùng bắt mép (px). Udemy: 30px trên mobile, 5px trên desktop. */
  dragMargin?: number;
  onStart?: (size: Box, hit: EdgeHit) => void;
  onMove: (size: Box, hit: EdgeHit) => void;
  onEnd?: (size: Box, hit: EdgeHit) => void;
}

/** Gắn hành vi kéo-mép vào `el`. Trả về hàm gỡ. */
export function attachResizer(el: HTMLElement, options: ResizerOptions): () => void {
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  let drag: { id: number; startX: number; startY: number; start: Box; hit: EdgeHit; last: Box } | null = null;

  const localPoint = (event: PointerEvent) => {
    const rect = el.getBoundingClientRect();
    return { rect, x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const hitFor = (event: PointerEvent) => {
    const { rect, x, y } = localPoint(event);
    // ngón tay to hơn con trỏ chuột: tăng vùng bắt mép khi input là cảm ứng
    const margin = options.dragMargin ?? (event.pointerType === 'touch' || coarse ? 30 : 6);
    return { rect, hit: edgeAt(rect, x, y, margin, options.edges) };
  };

  const onHover = (event: PointerEvent) => {
    if (drag) return;
    el.style.cursor = cursorFor(hitFor(event).hit);
  };

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const { rect, hit } = hitFor(event);
    if (!hasEdge(hit)) return; // nhấn vào nội dung: để trình duyệt xử lý (chọn chữ, focus…)
    event.preventDefault();
    el.setPointerCapture(event.pointerId);
    const start = { width: rect.width, height: rect.height };
    drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, start, hit, last: start };
    // giữ con trỏ resize kể cả khi chuột rời khỏi mép, và tắt pointer-events của iframe
    document.documentElement.classList.add('is-resizing');
    document.documentElement.style.setProperty('--resize-cursor', cursorFor(hit));
    options.onStart?.(start, hit);
  };

  const onMove = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    drag.last = computeSize(drag.start, event.clientX - drag.startX, event.clientY - drag.startY, drag.hit, options);
    options.onMove(drag.last, drag.hit);
  };

  const finish = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    const { last, hit } = drag;
    drag = null;
    document.documentElement.classList.remove('is-resizing');
    options.onEnd?.(last, hit);
  };

  el.addEventListener('pointermove', onHover);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', finish);
  el.addEventListener('pointercancel', finish);
  return () => {
    el.removeEventListener('pointermove', onHover);
    el.removeEventListener('pointerdown', onDown);
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', finish);
    el.removeEventListener('pointercancel', finish);
    document.documentElement.classList.remove('is-resizing');
  };
}

// ---------------------------------------------------------------- mép cuộn mờ dần

/** Mép nào đang còn nội dung bị che (cần làm mờ). */
export type FadeState = { start: boolean; end: boolean };

/**
 * `scrollLeft` trong RTL là số âm (0 ở mép phải, -max ở mép trái) trên mọi trình duyệt hiện đại,
 * nên lấy trị tuyệt đối rồi tính theo "đầu" và "cuối" của dòng chữ thay vì trái/phải.
 */
export function fadeState(scrollLeft: number, scrollWidth: number, clientWidth: number, threshold = 10): FadeState {
  const max = scrollWidth - clientWidth;
  if (max <= 1) return { start: false, end: false }; // không tràn: không làm mờ gì cả
  const pos = Math.abs(scrollLeft);
  return { start: pos > threshold, end: pos < max - threshold };
}

/** Theo dõi một hàng cuộn ngang, gọi `onChange` khi trạng thái mờ đổi (kể cả khi đổi kích thước). */
export function watchFade(scroller: HTMLElement, onChange: (state: FadeState) => void, threshold = 10): () => void {
  let last = '';
  const update = () => {
    const state = fadeState(scroller.scrollLeft, scroller.scrollWidth, scroller.clientWidth, threshold);
    const key = `${state.start}${state.end}`;
    if (key === last) return; // tránh render lại ở mỗi sự kiện scroll
    last = key;
    onChange(state);
  };
  update();
  scroller.addEventListener('scroll', update, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
  ro?.observe(scroller);
  // nội dung bên trong đổi (thêm/bớt chip) cũng làm scrollWidth đổi
  if (scroller.firstElementChild) ro?.observe(scroller.firstElementChild);
  return () => {
    scroller.removeEventListener('scroll', update);
    ro?.disconnect();
  };
}

/** Giá trị `mask-image` tương ứng: mờ dần về trong suốt, chạy trên mọi màu nền. */
export function fadeMask({ start, end }: FadeState, size = 48, rtl = false): string {
  const s = start ? `transparent, #000 ${size}px` : '#000, #000';
  const e = end ? `#000 calc(100% - ${size}px), transparent` : '#000';
  // gradient không có hướng "logic", nên RTL thì đổi chiều bằng tay
  return `linear-gradient(to ${rtl ? 'left' : 'right'}, ${s}, ${e})`;
}

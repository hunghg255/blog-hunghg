/**
 * Theo dõi viewport của danh sách tin nhắn, kiểu WhatsApp Web 2020 (module `bggagdeaef` ConversationMsgs).
 *
 * - Tìm tin đầu tiên đang thấy bằng binary search trên trạng thái "nằm trên / đang thấy", rồi đi tiếp
 *   cho tới tin đầu tiên không còn thấy: O(log n + số tin trên màn hình) lần đọc vị trí.
 * - Tìm date marker đang "phụ trách" màn hình bằng binary search theo `offsetTop <= scrollTop + 8.5`.
 * - Sticky date marker: hiện khi người dùng cuộn, tự ẩn sau 3 giây, không hiện nếu vừa cuộn bằng code (< 200ms).
 * - Giữ chỗ đọc khi layout đổi (mở/đóng panel): lưu khoảng cách từ đáy tin cuối đang thấy tới đáy viewport.
 * - Tạm dừng media (GIF) vừa rời khỏi màn hình bằng cách so tập đang thấy cũ và mới.
 *
 * Mọi vị trí tính theo `offsetTop`, nên container phải là offsetParent của item (position: relative).
 */

export type Visibility = 'above' | 'visible' | 'below';

export function visibilityOf(el: HTMLElement, container: HTMLElement): Visibility {
  const top = el.offsetTop - container.scrollTop;
  if (top + el.offsetHeight <= 0) return 'above';
  if (top >= container.clientHeight) return 'below';
  return 'visible';
}

/** Chỉ số nhỏ nhất trong [0, n) mà `isBefore(i)` sai; giả định `isBefore` đúng liền một đoạn đầu. */
export function lowerBound(n: number, isBefore: (i: number) => boolean): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (isBefore(mid)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface VisibleRange {
  /** chỉ số tin đầu đang thấy, -1 nếu không có */
  first: number;
  /** chỉ số tin cuối đang thấy (bao gồm), -1 nếu không có */
  last: number;
  /** số lần đọc vị trí đã dùng, để so với quét tuần tự */
  reads: number;
}

/**
 * Khoảng tin đang thấy. `getEl(i)` có thể trả null (item chưa gắn ref): bản gốc ném lỗi
 * "msgRef not found!", ở đây coi như dừng.
 */
export function findVisibleRange(
  count: number,
  getEl: (i: number) => HTMLElement | null,
  container: HTMLElement,
): VisibleRange {
  let reads = 0;
  const vis = (i: number): Visibility | null => {
    const el = getEl(i);
    if (!el) return null;
    reads++;
    return visibilityOf(el, container);
  };
  const first = lowerBound(count, (i) => vis(i) === 'above');
  let last = first - 1;
  for (let i = first; i < count && vis(i) === 'visible'; i++) last = i;
  return last < first ? { first: -1, last: -1, reads } : { first, last, reads };
}

/** Hằng của bản gốc: marker còn cách đỉnh dưới 8.5px đã coi như "tới đỉnh", để chuyển ngày sớm hơn một chút. */
export const DATE_MARKER_FUDGE = 8.5;

/**
 * Chỉ số date marker cuối cùng có `top(i) <= scrollTop + fudge`; -1 nếu marker đầu còn ở dưới.
 * `top(i)` phải tăng dần theo i.
 */
export function findStickyDateIndex(
  count: number,
  top: (i: number) => number,
  scrollTop: number,
  fudge = DATE_MARKER_FUDGE,
): number {
  const limit = scrollTop + fudge;
  return lowerBound(count, (i) => top(i) <= limit) - 1;
}

export interface StickyDateOptions {
  onVisibility: (visible: boolean) => void;
  hideAfter?: number;
  /** bỏ qua lần cập nhật nếu vừa cuộn bằng code trong khoảng này */
  programmaticWindow?: number;
  now?: () => number;
}

/** Bật/tắt sticky date marker: hiện khi người dùng cuộn, ẩn sau `hideAfter` ms không cuộn. */
export class StickyDateController {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private lastProgrammatic = -Infinity;
  private visible = false;
  private readonly hideAfter: number;
  private readonly programmaticWindow: number;
  private readonly now: () => number;
  private readonly onVisibility: (visible: boolean) => void;

  constructor({ onVisibility, hideAfter = 3000, programmaticWindow = 200, now = Date.now }: StickyDateOptions) {
    this.onVisibility = onVisibility;
    this.hideAfter = hideAfter;
    this.programmaticWindow = programmaticWindow;
    this.now = now;
  }

  /** Gọi ngay trước khi gán scrollTop bằng code (bản gốc: setScrollTop ghi programmaticScroll). */
  markProgrammatic() {
    this.lastProgrammatic = this.now();
  }

  /** Gọi sau mỗi lần cập nhật vị trí. `silent` = cập nhật do re-render, không phải do cuộn. */
  onPositionChange(silent = false) {
    if (silent || this.now() - this.lastProgrammatic < this.programmaticWindow) return;
    this.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.set(false), this.hideAfter);
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private set(visible: boolean) {
    if (visible === this.visible) return;
    this.visible = visible;
    this.onVisibility(visible);
  }
}

/** Khoảng cách từ đáy `el` tới đáy viewport (dương: el nằm trên đáy). */
export function captureBottomGap(container: HTMLElement, el: HTMLElement): number {
  return container.scrollTop + container.clientHeight - (el.offsetTop + el.offsetHeight);
}

/** Đặt lại scrollTop để `el` cách đáy viewport đúng `gap` như trước khi layout đổi. */
export function restoreBottomGap(container: HTMLElement, el: HTMLElement, gap: number) {
  container.scrollTop = el.offsetTop + el.offsetHeight + gap - container.clientHeight;
}

/** Các giá trị có trong `prev` mà không còn trong `next`: những item vừa rời màn hình. */
export function leftViewport<K, V>(prev: ReadonlyMap<K, V>, next: ReadonlyMap<K, V>): V[] {
  const out: V[] = [];
  prev.forEach((value, key) => {
    if (!next.has(key)) out.push(value);
  });
  return out;
}

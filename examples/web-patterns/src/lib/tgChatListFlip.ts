/**
 * Animation sắp xếp lại danh sách chat KHÔNG cần đo DOM, theo cách của Telegram Web A
 * (components/left/main/ChatList.tsx, Chat.tsx, hooks/useChatAnimationType.ts):
 *
 * - Mỗi dòng cao cố định và đặt `position: absolute; top: index * ROW_HEIGHT`.
 * - Khi thứ tự đổi, độ lệch của mỗi dòng là `orderDiff = newIndex - oldIndex` (dòng mới: -Infinity).
 * - FLIP không cần getBoundingClientRect: gán `translateY(-orderDiff * 100%)` (100% = chiều cao dòng)
 *   để dòng "đứng" ở chỗ cũ, rồi frame sau bỏ transform cho nó trượt về chỗ mới.
 * - Mẹo chính: đếm số dòng đi lên và đi xuống. NHÓM ÍT HƠN thì hiện mờ dần (fade) tại chỗ mới,
 *   nhóm đông hơn thì trượt. Chat nhảy từ vị trí 5 lên đầu sẽ fade ở trên cùng, 5 chat kia trượt
 *   xuống một nấc; không có cảnh một dòng bay xuyên qua cả danh sách.
 */

export type AnimationType = 'none' | 'move' | 'fade';

/** Tính độ lệch vị trí của từng id giữa hai thứ tự. Id mới xuất hiện có độ lệch -Infinity. */
export function getOrderDiff(prevIds: readonly string[] | undefined, nextIds: readonly string[]) {
  const diff: Record<string, number> = {};
  if (!prevIds) return diff;
  const prevIndex = new Map(prevIds.map((id, i) => [id, i]));
  nextIds.forEach((id, i) => {
    const before = prevIndex.get(id);
    diff[id] = before === undefined ? -Infinity : i - before;
  });
  return diff;
}

export type AnimationStrategy = 'telegram' | 'move-all' | 'none';

/** Chọn kiểu animation cho từng dòng. */
export function getAnimationTypes(
  diff: Record<string, number>,
  strategy: AnimationStrategy = 'telegram',
): Record<string, AnimationType> {
  const ids = Object.keys(diff);
  // như bản gốc: chat mới (-Infinity) cũng được đếm vào nhóm "đi lên"
  const up = ids.filter((id) => diff[id] < 0).length;
  const down = ids.filter((id) => diff[id] > 0).length;
  const types: Record<string, AnimationType> = {};

  for (const id of ids) {
    const d = diff[id];
    if (strategy === 'none' || d === 0) {
      types[id] = 'none';
    } else if (!Number.isFinite(d)) {
      types[id] = 'fade'; // dòng mới: không có chỗ cũ để trượt từ đó
    } else if (strategy === 'move-all') {
      types[id] = 'move';
    } else if ((d < 0 && up <= down) || (d > 0 && down < up)) {
      types[id] = 'fade'; // thuộc nhóm thiểu số
    } else {
      types[id] = 'move';
    }
  }
  return types;
}

export interface AnimateOptions {
  durationMs?: number;
  /** chờ thêm chút sau animation rồi mới dọn style (Telegram: ANIMATION_END_DELAY = 100ms) */
  endDelayMs?: number;
}

/**
 * Áp animation cho một dòng ngay sau khi nó đã được đặt ở `top` mới (gọi trong useLayoutEffect,
 * trước khi trình duyệt vẽ). Trả về hàm huỷ để dọn dẹp nếu thứ tự đổi tiếp giữa chừng.
 */
export function animateRow(
  element: HTMLElement,
  type: AnimationType,
  orderDiff: number,
  { durationMs = 250, endDelayMs = 100 }: AnimateOptions = {},
) {
  if (type === 'none') return () => {};

  element.style.transition = 'none';
  if (type === 'fade') {
    element.style.opacity = '0';
  } else {
    // 100% của translateY là chiều cao chính dòng đó: không cần đo gì cả
    element.style.transform = `translate3d(0, ${-orderDiff * 100}%, 0)`;
  }

  // Telegram gom các callback vào MỘT requestAnimationFrame (fastRaf); ở đây mỗi dòng một rAF
  // cũng được vì trình duyệt gộp chúng vào cùng frame.
  const raf = requestAnimationFrame(() => {
    element.style.transition =
      type === 'fade' ? `opacity ${durationMs}ms ease` : `transform ${durationMs}ms cubic-bezier(0.2, 0, 0, 1)`;
    element.style.opacity = '';
    element.style.transform = '';
  });
  const timer = window.setTimeout(() => {
    element.style.transition = '';
  }, durationMs + endDelayMs);

  return () => {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    element.style.transition = '';
    element.style.opacity = '';
    element.style.transform = '';
  };
}

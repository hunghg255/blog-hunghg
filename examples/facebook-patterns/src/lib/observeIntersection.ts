/**
 * Dùng chung IntersectionObserver giữa nhiều element.
 *
 * Ý tưởng lấy từ module `observeIntersection` của Facebook: các element có cùng
 * `root` + `rootMargin` + `threshold` sẽ dùng chung MỘT observer. Observer được
 * tạo khi có người cần và tự `disconnect()` khi không còn ai dùng.
 */

export type IntersectionCallback = (entry: IntersectionObserverEntry) => void;

export interface ObserveIntersectionOptions {
  root?: Element | Document | null;
  rootMargin?: string;
  threshold?: number | number[];
}

interface SharedObserver {
  observer: IntersectionObserver;
  callbacks: Map<Element, IntersectionCallback[]>;
  lastEntries: Map<Element, IntersectionObserverEntry>;
}

// WeakMap không cho dùng `null` làm key nên viewport được đại diện bằng một object rỗng.
const VIEWPORT_ROOT = {};
const observersByRoot = new WeakMap<object, Map<string, SharedObserver>>();

// Hai option giống nhau phải ra cùng một key: chuẩn hoá giá trị mặc định,
// sort + bỏ trùng threshold.
function getOptionsKey(rootMargin = '0px', threshold: number | number[] = 0): string {
  const normalizedThreshold = Array.isArray(threshold)
    ? [...new Set(threshold)].sort((a, b) => a - b)
    : [threshold];
  return JSON.stringify({ rootMargin, threshold: normalizedThreshold });
}

function reportCallbackError(error: unknown) {
  // Một callback lỗi không được làm hỏng các callback khác của cùng observer.
  // Ném lỗi ở task khác để vẫn hiện trên console / error tracking.
  setTimeout(() => {
    throw error;
  });
}

let observerCount = 0;
let targetCount = 0;

/** Số liệu để debug: đang có bao nhiêu observer và bao nhiêu element được theo dõi. */
export function getIntersectionStats() {
  return { observers: observerCount, targets: targetCount };
}

/**
 * Theo dõi `target`. Trả về hàm huỷ theo dõi (gọi nhiều lần cũng không sao).
 */
export function observeIntersection(
  target: Element,
  callback: IntersectionCallback,
  options: ObserveIntersectionOptions = {},
): () => void {
  const rootKey = options.root ?? VIEWPORT_ROOT;
  const optionsKey = getOptionsKey(options.rootMargin, options.threshold);

  let observersForRoot = observersByRoot.get(rootKey);
  if (!observersForRoot) {
    observersForRoot = new Map();
    observersByRoot.set(rootKey, observersForRoot);
  }

  let shared = observersForRoot.get(optionsKey);
  if (!shared) {
    const callbacks = new Map<Element, IntersectionCallback[]>();
    const lastEntries = new Map<Element, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          lastEntries.set(entry.target, entry);
          // copy mảng: callback có thể tự huỷ đăng ký trong lúc đang chạy
          for (const cb of callbacks.get(entry.target)?.slice() ?? []) {
            try {
              cb(entry);
            } catch (error) {
              reportCallbackError(error);
            }
          }
        }
      },
      {
        root: options.root ?? null,
        rootMargin: options.rootMargin,
        threshold: options.threshold,
      },
    );
    shared = { observer, callbacks, lastEntries };
    observersForRoot.set(optionsKey, shared);
    observerCount++;
  }

  const current = shared;
  let removed = false;
  let callbacksForTarget = current.callbacks.get(target);
  if (!callbacksForTarget) {
    callbacksForTarget = [];
    current.callbacks.set(target, callbacksForTarget);
    current.observer.observe(target);
    targetCount++;
  } else {
    // Element đã được observe trước đó nên observer sẽ không bắn entry đầu tiên
    // cho callback mới. Phát lại entry gần nhất để callback mới cũng biết trạng thái.
    const last = current.lastEntries.get(target);
    if (last) {
      queueMicrotask(() => {
        if (!removed) callback(last);
      });
    }
  }
  callbacksForTarget.push(callback);

  return () => {
    if (removed) return;
    removed = true;

    const list = current.callbacks.get(target);
    if (!list) return;
    const index = list.indexOf(callback);
    if (index !== -1) list.splice(index, 1);

    if (list.length === 0) {
      current.callbacks.delete(target);
      current.lastEntries.delete(target);
      current.observer.unobserve(target);
      targetCount--;
    }

    if (current.callbacks.size === 0) {
      current.observer.disconnect();
      observersForRoot!.delete(optionsKey);
      observerCount--;
      if (observersForRoot!.size === 0) observersByRoot.delete(rootKey);
    }
  };
}

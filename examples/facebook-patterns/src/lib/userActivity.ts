/**
 * Theo dõi người dùng còn "hoạt động" hay không (giống CometVisibilityUserActivityMonitor).
 * Không có input (chuột, phím, cuộn, chạm) trong `inactiveAfterMs` -> inactive.
 * Chỉ gắn event listener khi có người subscribe.
 */

export interface UserActivityMonitor {
  isUserActive(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'];

export function createUserActivityMonitor(inactiveAfterMs = 10_000): UserActivityMonitor {
  const listeners = new Set<(active: boolean) => void>();
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    listeners.forEach((listener) => listener(active));
  };

  const onActivity = () => {
    setActive(true);
    clearTimeout(timer);
    timer = setTimeout(() => setActive(false), inactiveAfterMs);
  };

  const start = () => {
    ACTIVITY_EVENTS.forEach((type) =>
      window.addEventListener(type, onActivity, { capture: true, passive: true }),
    );
    onActivity();
  };

  const stop = () => {
    ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, true));
    clearTimeout(timer);
    active = true;
  };

  return {
    isUserActive: () => active,
    subscribe(listener) {
      if (listeners.size === 0) start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

// 30 giây: người đọc bài dài có thể không chạm chuột/phím khá lâu; ngưỡng quá ngắn sẽ cắt
// mất thời gian đọc thật. Facebook còn chỉ dùng tín hiệu tab ẩn/hiện (xem bài viết).
export const defaultUserActivityMonitor = createUserActivityMonitor(30_000);

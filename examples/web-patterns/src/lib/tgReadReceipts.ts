/**
 * Đánh dấu "đã đọc" bằng IntersectionObserver
 * (ý tưởng từ components/middle/hooks/useMessageObservers.ts + hooks/useIntersectionObserver.ts
 * của Telegram Web A).
 *
 * - Không theo dõi cả bong bóng tin nhắn mà theo dõi một "bottom marker" mỏng ở đáy mỗi tin:
 *   tin chỉ tính là đã đọc khi ĐÁY của nó lọt vào khung nhìn.
 * - Mỗi lô callback lấy `maxId` của các marker đang hiện; chỉ gửi lên server khi
 *   `maxId >= firstUnreadId` (đọc theo "mốc", server tự hiểu mọi tin ≤ maxId đã đọc).
 * - Khi cửa sổ mất focus (hoặc tab bị ẩn), observer "đóng băng": entry vẫn được gom lại,
 *   tới lúc quay lại mới xử lý một lần.
 * - Gửi lên server được throttle 1 giây.
 */

export interface ReadTrackerOptions {
  /** khung cuộn chứa danh sách tin */
  root: HTMLElement;
  /** id tin chưa đọc đầu tiên tại thời điểm hiện tại (đọc mỗi lần cần) */
  getFirstUnreadId: () => number | undefined;
  /** gửi "đã đọc tới maxId" (đã throttle) */
  onReadUpTo: (maxId: number) => void;
  /** các tin có mention chưa đọc vừa được thấy */
  onMentionsSeen?: (ids: number[]) => void;
  throttleMs?: number;
  /** đóng băng khi cửa sổ mất focus như Telegram (true) hay chỉ khi tab bị ẩn (false) */
  freezeOnBlur?: boolean;
}

export interface ReadTracker {
  observe(marker: HTMLElement): () => void;
  freeze(): void;
  unfreeze(): void;
  isFrozen(): boolean;
  destroy(): void;
}

export function createReadTracker({
  root,
  getFirstUnreadId,
  onReadUpTo,
  onMentionsSeen,
  throttleMs = 1000,
  freezeOnBlur = true,
}: ReadTrackerOptions): ReadTracker {
  // entry mới nhất của từng marker, gom lại giữa các lần xử lý (và trong lúc đóng băng)
  const accumulator = new Map<Element, IntersectionObserverEntry>();
  let freezeCount = 0;
  let pendingWhileFrozen = false;

  // ---- throttle gửi lên server: chạy ngay lần đầu, sau đó tối đa 1 lần / throttleMs ----
  let lastSentMaxId = 0;
  let queuedMaxId = 0;
  let throttleTimer: ReturnType<typeof setTimeout> | undefined;
  const flushRead = () => {
    throttleTimer = undefined;
    // không bao giờ gửi mốc lùi lại: server coi maxId là "đã đọc tới đây"
    if (queuedMaxId > lastSentMaxId) {
      lastSentMaxId = queuedMaxId;
      onReadUpTo(queuedMaxId);
      throttleTimer = setTimeout(flushRead, throttleMs);
    }
  };
  const sendRead = (maxId: number) => {
    queuedMaxId = Math.max(queuedMaxId, maxId);
    if (throttleTimer === undefined) flushRead();
  };

  const process = () => {
    let maxId = 0;
    const mentionIds: number[] = [];
    accumulator.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const { dataset } = entry.target as HTMLElement;
      // album: marker mang id của ảnh CUỐI trong album
      const id = Number(dataset.lastMessageId || dataset.messageId);
      if (id > maxId) maxId = id;
      // Bản gốc viết `if (dataset.hasUnreadMention)`: thuộc tính bị render thành chuỗi "false"
      // sau khi mention đã đọc, mà chuỗi "false" vẫn là truthy. So sánh đúng giá trị:
      if (dataset.hasUnreadMention === 'true') mentionIds.push(id);
    });
    accumulator.clear();

    const firstUnreadId = getFirstUnreadId();
    if (firstUnreadId !== undefined && maxId >= firstUnreadId) sendRead(maxId);
    if (mentionIds.length) onMentionsSeen?.(mentionIds);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => accumulator.set(entry.target, entry));
      if (freezeCount > 0) {
        pendingWhileFrozen = true;
        return;
      }
      process();
    },
    { root },
  );

  const freeze = () => {
    freezeCount++;
  };
  const unfreeze = () => {
    if (freezeCount === 0) return;
    freezeCount--;
    if (freezeCount === 0 && pendingWhileFrozen) {
      pendingWhileFrozen = false;
      process();
    }
  };

  // ---- nền: blur/focus như Telegram, hoặc visibilitychange ----
  let frozenByBackground = false;
  const syncBackground = () => {
    const inBackground = freezeOnBlur ? !document.hasFocus() || document.hidden : document.hidden;
    if (inBackground && !frozenByBackground) {
      frozenByBackground = true;
      freeze();
    } else if (!inBackground && frozenByBackground) {
      frozenByBackground = false;
      unfreeze();
    }
  };
  syncBackground();
  window.addEventListener('blur', syncBackground);
  window.addEventListener('focus', syncBackground);
  document.addEventListener('visibilitychange', syncBackground);

  return {
    observe(marker) {
      observer.observe(marker);
      return () => {
        observer.unobserve(marker);
        accumulator.delete(marker);
      };
    },
    freeze,
    unfreeze,
    isFrozen: () => freezeCount > 0,
    destroy() {
      observer.disconnect();
      clearTimeout(throttleTimer);
      window.removeEventListener('blur', syncBackground);
      window.removeEventListener('focus', syncBackground);
      document.removeEventListener('visibilitychange', syncBackground);
    },
  };
}

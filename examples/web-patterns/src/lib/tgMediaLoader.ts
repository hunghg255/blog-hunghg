/**
 * Tải media kiểu Telegram (Telegram #18):
 * - UI chỉ cầm một chuỗi khoá ngắn ("msg123-45?size=m"), không cầm object nặng của API.
 * - Request trùng khoá được gộp làm một; mọi nơi gọi đều nhận tiến độ.
 * - Có bộ nhớ đọc ĐỒNG BỘ (getFromMemory) để lần render đầu đã có ảnh, khỏi nháy thumbnail.
 * Kèm hai mảnh nhỏ: quyết định có animate ảnh mờ → nét không, và cờ "đang buffer" chống chớp.
 */

export type Progress = (fraction: number) => void;

export interface MediaLoaderOptions<T> {
  /** tải thật (mạng, worker…); gọi onProgress từ 0 → 1 */
  download(key: string, onProgress: Progress): Promise<T>;
  /** số mục tối đa giữ trong bộ nhớ; bản gốc không giới hạn */
  maxItems?: number;
  /** được gọi khi một mục bị đẩy khỏi bộ nhớ, ví dụ để URL.revokeObjectURL */
  onEvict?(key: string, value: T): void;
}

export function createMediaLoader<T>({ download, maxItems = 200, onEvict }: MediaLoaderOptions<T>) {
  const memory = new Map<string, T>();
  const inflight = new Map<string, { promise: Promise<T | undefined>; listeners: Set<Progress> }>();
  const stats = { requests: 0, deduped: 0, memoryHits: 0 };

  const remember = (key: string, value: T) => {
    memory.delete(key);
    memory.set(key, value); // Map giữ thứ tự chèn: phần tử đầu là cũ nhất
    while (memory.size > maxItems) {
      const [oldKey, oldValue] = memory.entries().next().value as [string, T];
      memory.delete(oldKey);
      onEvict?.(oldKey, oldValue);
    }
  };

  return {
    /** Đọc đồng bộ, dùng ngay trong render. */
    getFromMemory(key: string): T | undefined {
      const value = memory.get(key);
      if (value !== undefined) {
        stats.memoryHits++;
        remember(key, value); // đánh dấu vừa dùng
      }
      return value;
    },

    fetch(key: string, onProgress?: Progress): Promise<T | undefined> {
      const cached = memory.get(key);
      if (cached !== undefined) return Promise.resolve(cached);

      const existing = inflight.get(key);
      if (existing) {
        // bản gốc: người gọi thứ hai không bao giờ nhận tiến độ vì callback chỉ gắn với request đầu
        if (onProgress) existing.listeners.add(onProgress);
        stats.deduped++;
        return existing.promise;
      }

      const listeners = new Set<Progress>(onProgress ? [onProgress] : []);
      stats.requests++;
      const promise = download(key, (p) => listeners.forEach((l) => l(p)))
        .then((value) => {
          remember(key, value);
          return value;
        })
        .catch(() => undefined) // lỗi thì trả undefined như bản gốc, UI tự hiện lại nút tải
        .finally(() => inflight.delete(key));
      inflight.set(key, { promise, listeners });
      return promise;
    },

    /** Người gọi rời đi (unmount): gỡ callback tiến độ của riêng họ. */
    cancelProgress(key: string, onProgress: Progress) {
      inflight.get(key)?.listeners.delete(onProgress);
    },

    clear() {
      memory.forEach((value, key) => onEvict?.(key, value));
      memory.clear();
    },

    stats,
  };
}

// ---------- Ảnh mờ → ảnh nét ----------

export const TRANSITION_MS = { fast: 200, slow: 350 } as const;

/**
 * Quyết định lúc mount: ảnh ĐÃ có trong bộ nhớ thì hiện thẳng, không fade.
 * Chỉ ảnh phải chờ mạng mới được animate từ thumbnail mờ sang ảnh nét.
 */
export function planMediaTransition(isLoadedAtMount: boolean, speed: keyof typeof TRANSITION_MS = 'fast') {
  return {
    willAnimate: !isLoadedAtMount,
    /** giữ thumbnail thêm đúng bằng thời lượng fade rồi mới gỡ, để không lộ nền trống giữa chừng */
    keepThumbMs: isLoadedAtMount ? 0 : TRANSITION_MS[speed],
  };
}

/**
 * Ảnh về sớm hơn `minDelay` (ví dụ animation mở viewer chưa xong) thì chờ cho đủ rồi mới hiện.
 * Trả về số ms còn phải chờ.
 */
export const remainingDelay = (startedAt: number, now: number, minDelay = 0) => Math.max(0, minDelay - (now - startedAt));

// ---------- Spinner buffer không chớp ----------

export const MIN_READY_STATE = 3; // HAVE_FUTURE_DATA

export function isBufferedNow(media: Pick<HTMLMediaElement, 'readyState' | 'currentTime'>) {
  return media.readyState >= MIN_READY_STATE || media.currentTime > 0;
}

/**
 * Phần đã tải TÍNH TỪ vị trí đang phát. Bản gốc lấy `buffered.end(0) / duration`, tức chỉ khoảng
 * đầu tiên: sau khi tua tới giữa video, thanh buffer vẫn chỉ phần đã tải ở đầu.
 */
export function bufferedProgress(media: Pick<HTMLMediaElement, 'buffered' | 'currentTime' | 'duration'>) {
  const { buffered, currentTime, duration } = media;
  if (!duration || !Number.isFinite(duration)) return 0;
  for (let i = 0; i < buffered.length; i++) {
    if (buffered.start(i) <= currentTime + 0.1 && currentTime <= buffered.end(i)) {
      return buffered.end(i) / duration;
    }
  }
  return 0;
}

/**
 * Cờ debounce cả hai chiều: chỉ đổi khi giá trị mới giữ nguyên `ms` (bản gốc 200ms).
 * Nhờ vậy video đã buffer, khi remount bắn liền loadstart → playing, không làm spinner nháy một frame.
 */
export function createDebouncedFlag(initial: boolean, ms: number, onChange: (value: boolean) => void) {
  let current = initial;
  let pending: boolean | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    set(value: boolean) {
      if (value === current) {
        clearTimeout(timer);
        pending = undefined;
        return;
      }
      if (value === pending) return;
      pending = value;
      clearTimeout(timer);
      timer = setTimeout(() => {
        current = value;
        pending = undefined;
        onChange(value);
      }, ms);
    },
    get value() {
      return current;
    },
    dispose() {
      clearTimeout(timer);
    },
  };
}

/**
 * Lưu global state xuống localStorage để lần mở sau hiện ngay
 * (ý tưởng từ Telegram Web A: global/cache.ts).
 *
 * - Không ghi mỗi lần state đổi: gom trong 5 giây, rồi chờ lúc trình duyệt rảnh mới ghi.
 * - Không ghi lúc đang có animation nặng (JSON.stringify chạy trên main thread).
 * - Cắt tỉa trước khi ghi: chỉ giữ phần cần để vẽ màn hình đầu (30 chat, tin đang hiện…).
 * - Khi đọc: trộn giá trị mặc định cho các field mà bản cache cũ chưa có.
 *
 * Khác bản gốc: có số phiên bản (version), lần bị hoãn vì animation được hẹn lại thay vì bỏ,
 * ghi khi tab bị ẩn (pagehide/visibilitychange) thay vì blur/beforeunload, bắt lỗi quota.
 */

export interface PersistOptions<S, C> {
  key: string;
  /** đổi số này khi định dạng cache không còn tương thích: cache cũ bị bỏ */
  version: number;
  /** cắt state thành phần cần lưu */
  reduce: (state: S) => C;
  /** dựng lại state từ cache + state mặc định */
  restore: (cached: C, initial: S) => S;
  getState: () => S;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  throttleMs?: number;
  /** true = đang bận (animation nặng…), hoãn ghi */
  isBusy?: () => boolean;
  /** `chars`: số ký tự JSON (giới hạn localStorage tính theo ký tự, khoảng 5 triệu mỗi origin) */
  onWrite?: (info: { chars: number; ms: number; reason: string }) => void;
  /** `chars` có khi lỗi xảy ra lúc setItem (thường là vượt quota) */
  onError?: (error: unknown, info?: { chars: number }) => void;
}

interface Envelope<C> {
  v: number;
  savedAt: number;
  data: C;
}

const requestIdle: (cb: () => void) => void =
  typeof requestIdleCallback === 'function'
    ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
    : (cb) => setTimeout(cb, 1);

export function createStatePersister<S, C>(options: PersistOptions<S, C>) {
  const { key, version, reduce, restore, getState, throttleMs = 5000, isBusy, onWrite, onError } = options;
  const storage = options.storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dirty = false;
  let enabled = true;

  function write(reason: string, force = false) {
    timer = undefined;
    if (!enabled || !storage || !dirty) return;
    if (!force && isBusy?.()) {
      // bản gốc bỏ lượt ghi này; ở đây hẹn lại để thay đổi không bị mất
      schedule();
      return;
    }
    const start = performance.now();
    let json: string | undefined;
    try {
      const envelope: Envelope<C> = { v: version, savedAt: Date.now(), data: reduce(getState()) };
      json = JSON.stringify(envelope);
      storage.setItem(key, json);
      dirty = false;
      onWrite?.({ chars: json.length, ms: performance.now() - start, reason });
    } catch (error) {
      // QuotaExceededError, state có vòng tham chiếu…: không làm hỏng app
      onError?.(error, json === undefined ? undefined : { chars: json.length });
    }
  }

  /** Gọi mỗi khi state đổi. Gom lại: tối đa một lần ghi mỗi `throttleMs`, và chỉ lúc rảnh. */
  function schedule() {
    dirty = true;
    if (timer !== undefined) return;
    timer = setTimeout(() => requestIdle(() => write('throttle')), throttleMs);
  }

  /** Ghi ngay (tab sắp bị ẩn hoặc đóng). */
  function flush(reason = 'flush') {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    // sắp mất trang thì vẫn phải ghi, dù đang có animation
    write(reason, true);
  }

  /** Đọc cache. Không có, hỏng hoặc khác phiên bản thì trả state mặc định. */
  function load(initial: S): { state: S; fromCache: boolean; savedAt?: number } {
    if (!storage) return { state: initial, fromCache: false };
    try {
      const json = storage.getItem(key);
      if (!json) return { state: initial, fromCache: false };
      const envelope = JSON.parse(json) as Envelope<C>;
      if (envelope.v !== version) {
        storage.removeItem(key);
        return { state: initial, fromCache: false };
      }
      return { state: restore(envelope.data, initial), fromCache: true, savedAt: envelope.savedAt };
    } catch (error) {
      onError?.(error);
      return { state: initial, fromCache: false };
    }
  }

  const onHidden = () => {
    if (document.visibilityState === 'hidden') flush('hidden');
  };
  const onPageHide = () => flush('pagehide');
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', onPageHide);
  }

  /** Đăng xuất: xoá cache và ngừng ghi. */
  function clear() {
    enabled = false;
    if (timer !== undefined) clearTimeout(timer);
    storage?.removeItem(key);
  }

  function destroy() {
    if (timer !== undefined) clearTimeout(timer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', onPageHide);
    }
  }

  return { schedule, flush, load, clear, destroy };
}

/** Trộn giá trị mặc định vào các object con mà cache cũ có thể thiếu field. Telegram làm tay từng field. */
export function withDefaults<T extends object>(initial: T, cached: Partial<T>, nestedKeys: (keyof T)[]): T {
  const result = { ...initial, ...cached } as T;
  for (const k of nestedKeys) {
    const base = initial[k];
    const saved = cached[k];
    if (base && typeof base === 'object' && saved && typeof saved === 'object') {
      result[k] = { ...(base as object), ...(saved as object) } as T[keyof T];
    }
  }
  return result;
}

/** Lấy các key có trong danh sách, giữ đúng thứ tự (Telegram: pick). */
export function pick<V>(record: Record<string | number, V>, keys: (string | number)[]) {
  const out: Record<string, V> = {};
  for (const k of keys) if (k in record) out[k] = record[k];
  return out;
}

/**
 * localStorage có hạn dùng (TTL) cho từng key, an toàn khi nhiều tab cùng ghi.
 * Ý tưởng từ ud-expiring-local-storage(-with-key-ttls) của Udemy:
 * - mỗi mục lưu kèm thời điểm hết hạn, đọc thấy hết hạn thì coi như không có;
 * - giới hạn số mục để một namespace không phình mãi;
 * - TRƯỚC khi ghi thì đọc lại bản mới nhất trong localStorage, để không đè mất thứ tab khác vừa ghi.
 */

interface Entry {
  v: unknown;
  /** thời điểm hết hạn, ms */
  exp: number;
}

type Data = Record<string, Entry>;

export interface ExpiringStorageOptions {
  /** TTL mặc định cho mỗi key, ms */
  ttl: number;
  maxItems?: number;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  now?: () => number;
}

/** localStorage có thể ném lỗi ngay khi truy cập (Safari riêng tư đời cũ, cookie bị chặn…). */
export function safeLocalStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  try {
    const probe = '__probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => void memory.set(k, v),
      removeItem: (k) => void memory.delete(k),
    };
  }
}

export function createExpiringStorage(
  namespace: string,
  { ttl, maxItems = 1000, storage = safeLocalStorage(), now = Date.now }: ExpiringStorageOptions,
) {
  const storageKey = `expiring:${namespace}`;

  // Luôn đọc từ storage, không giữ bản sao trong bộ nhớ: bản sao sẽ cũ đi ngay khi tab khác ghi.
  // Đổi lại mỗi lần đọc là một lần JSON.parse; namespace nhỏ thì không đáng kể.
  const read = (): Data => {
    try {
      const raw = storage.getItem(storageKey);
      const parsed: unknown = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? (parsed as Data) : {};
    } catch {
      return {}; // JSON hỏng (ai đó sửa tay, bản app cũ…): bắt đầu lại
    }
  };

  const write = (data: Data) => {
    try {
      if (Object.keys(data).length === 0) storage.removeItem(storageKey);
      else storage.setItem(storageKey, JSON.stringify(data));
      return true;
    } catch {
      return false; // QuotaExceededError: không làm hỏng luồng chính
    }
  };

  const prune = (data: Data) => {
    const t = now();
    for (const key of Object.keys(data)) if (!(data[key]?.exp > t)) delete data[key];
    return data;
  };

  return {
    get<T = unknown>(key: string): T | null {
      const entry = read()[key];
      if (!entry) return null;
      if (entry.exp <= now()) {
        this.delete(key);
        return null;
      }
      return entry.v as T;
    },

    /** Trả về false nếu không ghi được (hết quota). */
    set(key: string, value: unknown, itemTtl = ttl): boolean {
      const data = prune(read()); // đọc lại NGAY TRƯỚC khi ghi
      if (!(key in data) && Object.keys(data).length >= maxItems) {
        // Udemy ném lỗi khi đầy; ở đây đẩy mục sắp hết hạn nhất ra để chỗ cho mục mới
        const oldest = Object.keys(data).reduce((a, b) => (data[a].exp <= data[b].exp ? a : b));
        delete data[oldest];
      }
      data[key] = { v: value, exp: now() + itemTtl };
      return write(data);
    },

    delete(key: string) {
      const data = read();
      if (key in data) {
        delete data[key];
        write(data);
      }
    },

    clear() {
      storage.removeItem(storageKey);
    },

    /** Dọn mục hết hạn, nên gọi một lần sau khi app khởi động xong. */
    sweep() {
      const data = read();
      const before = Object.keys(data).length;
      prune(data);
      if (Object.keys(data).length !== before) write(data);
      return before - Object.keys(data).length;
    },

    /** Dùng cho debug/demo: mọi mục còn hạn kèm số ms còn lại. */
    entries() {
      const t = now();
      return Object.entries(prune(read())).map(([key, e]) => ({ key, value: e.v, remaining: e.exp - t }));
    },
  };
}

export type ExpiringStorage = ReturnType<typeof createExpiringStorage>;

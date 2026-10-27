/**
 * localStorage tự dọn khi đầy quota (ý tưởng từ CacheStorage của Facebook).
 *
 * - Mỗi giá trị lưu kèm thời điểm ghi: {"__t": 1730000000000, "__v": …}.
 * - setItem ném QuotaExceededError → xoá NỬA số entry cũ nhất rồi thử lại, lặp tới khi
 *   ghi được hoặc không còn gì để xoá.
 * - Key có tiền tố riêng; đổi version thì chỉ xoá key của mình.
 *
 * Khác bản gốc: chỉ dọn key mang tiền tố của chính kho này (bản gốc quét mọi key trong
 * localStorage và xoá luôn giá trị không phải JSON của code khác), chuỗi thô cũng có
 * timestamp để dọn được, và `remove()` của callback dùng splice.
 */

export interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function isQuotaError(error: unknown): boolean {
  if (!(error instanceof DOMException)) return false;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox cũ
    error.code === 22 ||
    error.code === 1014
  );
}

interface Envelope {
  __t: number;
  __v: unknown;
}

export interface QuotaStorageOptions {
  backend: StorageLike;
  prefix?: string;
  version?: string;
  now?: () => number;
}

export function createQuotaStorage({ backend, prefix = '_qs_', version = '1', now = Date.now }: QuotaStorageOptions) {
  // tiền tố rỗng = mọi key trong storage đều bị coi là "của mình", kể cả key của code khác
  if (!prefix) throw new Error('prefix không được rỗng');
  const versionKey = `${prefix}version`;
  const callbacks: Array<(key: string) => void> = [];
  const ownKeys = () => {
    const keys: string[] = [];
    for (let i = 0; i < backend.length; i++) {
      const k = backend.key(i);
      if (k && k.startsWith(prefix) && k !== versionKey) keys.push(k);
    }
    return keys;
  };

  if (backend.getItem(versionKey) !== version) {
    ownKeys().forEach((k) => backend.removeItem(k));
    try {
      backend.setItem(versionKey, version);
    } catch {
      /* đầy ngay từ đầu: lần ghi sau sẽ dọn */
    }
  }

  /** Xoá nửa cũ nhất của các entry thuộc kho này. Trả về số key đã xoá. */
  function evictOldestHalf(): number {
    const entries: Array<[string, number]> = [];
    for (const key of ownKeys()) {
      const raw = backend.getItem(key);
      try {
        const parsed = JSON.parse(raw ?? '') as Envelope;
        entries.push([key, typeof parsed.__t === 'number' ? parsed.__t : 0]);
      } catch {
        entries.push([key, 0]); // hỏng thì coi là cũ nhất
      }
    }
    entries.sort((a, b) => a[1] - b[1]);
    const count = Math.ceil(entries.length / 2);
    entries.slice(0, count).forEach(([key]) => backend.removeItem(key));
    return count;
  }

  return {
    /** Trả về false nếu dọn hết vẫn không ghi được (giá trị quá lớn so với quota). */
    set(key: string, value: unknown): boolean {
      const payload = JSON.stringify({ __t: now(), __v: value } satisfies Envelope);
      for (;;) {
        try {
          backend.setItem(prefix + key, payload);
          callbacks.forEach((cb) => cb(key));
          return true;
        } catch (error) {
          if (!isQuotaError(error)) throw error;
          if (evictOldestHalf() === 0) return false;
        }
      }
    },
    get<T = unknown>(key: string): T | undefined {
      const raw = backend.getItem(prefix + key);
      if (raw == null) return undefined;
      try {
        return (JSON.parse(raw) as Envelope).__v as T;
      } catch {
        return undefined;
      }
    },
    remove(key: string) {
      backend.removeItem(prefix + key);
    },
    keys: () => ownKeys().map((k) => k.slice(prefix.length)),
    onChange(cb: (key: string) => void) {
      callbacks.push(cb);
      return {
        remove() {
          const i = callbacks.indexOf(cb);
          if (i !== -1) callbacks.splice(i, 1);
        },
      };
    },
    evictOldestHalf,
  };
}

/**
 * Storage giả có dung lượng nhỏ (tính theo số ký tự key + value, giống cách trình duyệt
 * đếm UTF-16), để demo đầy quota trong vài cú bấm thay vì phải ghi 5MB.
 */
export function createLimitedStorage(capacityChars: number): StorageLike & { used(): number; dump(): Array<[string, string]> } {
  const map = new Map<string, string>();
  const used = () => [...map].reduce((sum, [k, v]) => sum + k.length + v.length, 0);
  return {
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem(k, v) {
      const before = map.get(k);
      const next = used() - (before ? k.length + before.length : 0) + k.length + v.length;
      if (next > capacityChars) throw new DOMException('Quota exceeded', 'QuotaExceededError');
      map.set(k, v);
    },
    removeItem: (k) => void map.delete(k),
    used,
    dump: () => [...map],
  };
}

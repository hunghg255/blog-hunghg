/**
 * Danh sách thread sắp theo mốc hoạt động mới nhất, phân trang bằng "ranged callback"
 * (ý tưởng từ MercuryOrderedThreadlist + RangedCallbackManager của Messenger web).
 *
 * - Chỉ mục giữ id, thứ tự lấy từ key (timestamp) của từng id, sắp giảm dần.
 * - UI xin một khoảng [start, start + limit). Đủ dữ liệu thì callback chạy ngay;
 *   thiếu thì callback được XẾP CHỜ, đồng thời trả về số phần tử còn thiếu để gọi fetch.
 *   UI không bao giờ thấy một khoảng có "lỗ".
 * - Đã tới cuối danh sách hoặc fetch lỗi: callback chờ được chạy với phần đang có.
 */

export interface RangeResult<T> {
  items: T[];
  /** lỗi fetch nếu khoảng xin vượt quá phần đã có, ngược lại null */
  error: unknown;
}

type Waiter<T> = { start: number; limit: number; callback: (result: RangeResult<T>) => void };

export class RangedIndex<T> {
  private ids: T[] = [];
  private known = new Set<T>();
  private ended = false;
  private error: unknown = null;
  private waiters = new Map<number, Waiter<T>>();
  private nextWaiterId = 1;

  constructor(
    /** key để sắp; undefined thì xếp cuối */
    private getKey: (id: T) => number | undefined,
    /** mặc định: key lớn đứng trước (mới nhất trước) */
    private compare: (a: number, b: number) => number = (a, b) => b - a,
  ) {}

  /**
   * Xin khoảng [start, start + limit). Trả về id để huỷ chờ và số phần tử còn thiếu
   * (0 nghĩa là callback đã chạy xong ngay trong lần gọi này).
   */
  request(start: number, limit: number, callback: (result: RangeResult<T>) => void) {
    const waiter = { start, limit, callback };
    if (this.tryRun(waiter)) return { id: 0, missing: 0 };
    const id = this.nextWaiterId++;
    this.waiters.set(id, waiter);
    return { id, missing: start + limit - this.ids.length };
  }

  unsubscribe(id: number) {
    this.waiters.delete(id);
  }

  /** Thêm id (bỏ trùng), sắp lại rồi chạy những callback nay đã đủ dữ liệu. */
  add(newIds: T[]) {
    let changed = false;
    for (const id of newIds) {
      if (this.known.has(id)) continue;
      this.known.add(id);
      this.ids.push(id);
      changed = true;
    }
    if (!changed) return;
    this.error = null;
    this.resort();
    this.flush();
  }

  remove(ids: T[]) {
    const drop = new Set(ids.filter((id) => this.known.has(id)));
    if (drop.size === 0) return;
    drop.forEach((id) => this.known.delete(id));
    this.ids = this.ids.filter((id) => !drop.has(id));
  }

  /** Key của id đã đổi (vd: thread có tin mới): sắp lại. */
  resort() {
    const keyOf = (id: T) => this.getKey(id) ?? Number.NEGATIVE_INFINITY;
    // Array.prototype.sort đã ổn định (stable) từ ES2019: thread cùng key giữ thứ tự cũ
    this.ids.sort((a, b) => {
      const ka = keyOf(a);
      const kb = keyOf(b);
      if (ka === kb) return 0;
      if (ka === Number.NEGATIVE_INFINITY) return 1;
      if (kb === Number.NEGATIVE_INFINITY) return -1;
      return this.compare(ka, kb);
    });
  }

  /** Server báo không còn gì để tải: callback đang chờ nhận phần còn lại. */
  setEnded() {
    if (this.ended) return;
    this.ended = true;
    this.flush();
  }

  setError(error: unknown) {
    if (this.error === error) return;
    this.error = error;
    this.flush();
  }

  get size() {
    return this.ids.length;
  }

  get hasEnded() {
    return this.ended;
  }

  get pendingCount() {
    return this.waiters.size;
  }

  /** Số phần tử cần có để mọi callback đang chờ chạy được (0 nếu không ai chờ). */
  get wantedSize() {
    let max = 0;
    for (const w of this.waiters.values()) max = Math.max(max, w.start + w.limit);
    return max;
  }

  getAll() {
    return this.ids.slice();
  }

  /** Mọi id có key "mới hơn hoặc bằng" mốc cho trước (dùng cho "tải tới khi gặp tin X"). */
  getUntil(key: number) {
    const out: T[] = [];
    for (const id of this.ids) {
      const k = this.getKey(id);
      if (k !== undefined && this.compare(k, key) > 0) break;
      out.push(id);
    }
    return out;
  }

  private tryRun(waiter: Waiter<T>) {
    const end = waiter.start + waiter.limit;
    const enough = end <= this.ids.length;
    if (!enough && !this.ended && this.error == null) return false;
    waiter.callback({
      items: this.ids.slice(waiter.start, end),
      error: enough ? null : this.error,
    });
    return true;
  }

  private flush() {
    for (const [id, waiter] of this.waiters) {
      if (this.tryRun(waiter)) this.waiters.delete(id);
    }
  }
}

// ---------------------------------------------------------------------------
// Presence lưu qua điều hướng, tự vô hiệu khi đổi schema (ý tưởng từ PresenceCookieManager)
// ---------------------------------------------------------------------------

export interface KeyValueStore {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface PresenceRecord {
  /** version schema của dữ liệu */
  v: number;
  user: string;
  /** giây, lúc ghi */
  time: number;
  [field: string]: unknown;
}

export interface PresenceStoreOptions {
  key?: string;
  version: number;
  currentUser: string;
  /** nơi lưu chính, vd sessionStorage; null nếu không dùng được */
  primary: KeyValueStore | null;
  /** nơi lưu dự phòng, vd cookie */
  fallback: KeyValueStore;
  now?: () => number;
}

export function createPresenceStore({
  key = 'presence',
  version,
  currentUser,
  primary,
  fallback,
  now = () => Date.now(),
}: PresenceStoreOptions) {
  const readRaw = () => primary?.get(key) ?? fallback.get(key);

  /** null nếu không có, hỏng, khác user hoặc khác version. */
  function read(): PresenceRecord | null {
    const raw = readRaw();
    if (!raw) return null;
    try {
      const record = JSON.parse(raw) as PresenceRecord;
      if (record.user !== currentUser) return null;
      if (record.v !== version) return null;
      return record;
    } catch {
      return null;
    }
  }

  /** version của dữ liệu đang nằm trong storage (kể cả khác version mình), để quyết định có ghi đè không. */
  function storedVersion(): number | null {
    const raw = readRaw();
    if (!raw) return null;
    try {
      const v = (JSON.parse(raw) as Partial<PresenceRecord>).v;
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  }

  /**
   * Ghi. Trả false nếu dữ liệu đang có thuộc version MỚI HƠN: tab chạy bản cũ không được
   * ghi đè lên dữ liệu của tab đã lên bản mới.
   */
  function write(fields: Record<string, unknown>): boolean {
    const existing = storedVersion();
    if (existing !== null && existing > version) return false;
    const record: PresenceRecord = {
      ...fields,
      v: version,
      user: currentUser,
      time: Math.floor(now() / 1000),
    };
    const value = JSON.stringify(record);
    if (primary) {
      primary.set(key, value);
      fallback.remove(key);
    } else {
      fallback.set(key, value);
    }
    return true;
  }

  function clear() {
    primary?.remove(key);
    fallback.remove(key);
  }

  return { read, write, clear, storedVersion };
}

export function storageAdapter(storage: Storage | undefined): KeyValueStore | null {
  if (!storage) return null;
  try {
    const probe = '__probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
  } catch {
    return null; // Safari private mode cũ, quota = 0…
  }
  return {
    get: (k) => storage.getItem(k),
    set: (k, v) => storage.setItem(k, v),
    remove: (k) => storage.removeItem(k),
  };
}

export function memoryAdapter(): KeyValueStore & { dump(): Record<string, string> } {
  const map = new Map<string, string>();
  return {
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    dump: () => Object.fromEntries(map),
  };
}

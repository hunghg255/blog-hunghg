/**
 * Ba mẹo quanh "gọi API một lần cho nhiều nơi cần", học từ cachedGraphAPI, preloadedGraphAPI
 * và một bug của MessengerPaymentFriendsLocalCache:
 * 1. Cache chính Promise: request đang bay được dùng chung; lỗi cũng được cache nhưng chỉ vài giây
 *    (negative cache) để nhiều component không cùng retry dồn dập.
 * 2. Loader lười kiểu single-flight phải bỏ Promise khi lỗi, không thì lỗi bị nhớ vĩnh viễn.
 * 3. Dữ liệu server nhúng sẵn vào HTML đua với request của client: chờ một chút, khớp thì dùng,
 *    không khớp hoặc tới muộn thì gọi API.
 * Khác bản gốc: hết hạn tính lười theo đồng hồ tiêm vào, khoá ổn định không phụ thuộc thứ tự thuộc tính,
 * invalidate chỉ có tác dụng một lần, giới hạn số entry.
 */

// ───────────────────────── 1. Cache Promise ─────────────────────────

export type EntryStatus = 'pending' | 'fulfilled' | 'rejected';

export interface PromiseCacheOptions {
  /** giữ kết quả thành công bao lâu; undefined = tới khi bị đẩy ra hoặc invalidate */
  ttlMs?: number;
  /** giữ lỗi bao lâu (bản gốc: 0,15 phút = 9 giây) */
  errorTtlMs?: number;
  /** số entry tối đa, đẩy entry dùng lâu nhất ra trước */
  maxEntries?: number;
  now?: () => number;
}

interface Entry<T> {
  promise: Promise<T>;
  status: EntryStatus;
  settledAt: number;
  group?: string;
}

export interface CacheInfo {
  key: string;
  status: EntryStatus;
  /** còn bao lâu thì hết hạn, Infinity nếu không hết hạn */
  expiresInMs: number;
  group?: string;
}

export interface PromiseCache<T> {
  get(key: string, fetcher: () => Promise<T>, options?: { group?: string; bypass?: boolean }): Promise<T>;
  /** xoá một key (hoặc tất cả nếu không truyền); chỉ ảnh hưởng lần get kế tiếp */
  invalidate(key?: string): void;
  invalidateGroup(group: string): void;
  entries(): CacheInfo[];
}

export function createPromiseCache<T>(options: PromiseCacheOptions = {}): PromiseCache<T> {
  const { ttlMs, errorTtlMs = 9_000, maxEntries = 500, now = Date.now } = options;
  const map = new Map<string, Entry<T>>();

  const expiresIn = (e: Entry<T>) => {
    if (e.status === 'pending') return Infinity; // đang bay: luôn dùng chung
    const ttl = e.status === 'rejected' ? errorTtlMs : ttlMs;
    return ttl == null ? Infinity : e.settledAt + ttl - now();
  };

  const cache: PromiseCache<T> = {
    get(key, fetcher, opts = {}) {
      const hit = map.get(key);
      if (hit && !opts.bypass && expiresIn(hit) > 0) {
        // chạm vào thì đưa về cuối Map: Map giữ thứ tự chèn nên đầu Map là entry cũ nhất
        map.delete(key);
        map.set(key, hit);
        return hit.promise;
      }
      const entry = { status: 'pending', settledAt: 0, group: opts.group } as Entry<T>;
      entry.promise = fetcher().then(
        (value) => {
          entry.status = 'fulfilled';
          entry.settledAt = now();
          return value;
        },
        (error: unknown) => {
          entry.status = 'rejected';
          entry.settledAt = now();
          throw error;
        },
      );
      // ai không bắt lỗi thì cũng không làm hiện "Uncaught (in promise)"
      entry.promise.catch(() => {});
      map.set(key, entry);
      if (map.size > maxEntries) map.delete(map.keys().next().value!);
      return entry.promise;
    },
    invalidate(key) {
      if (key == null) map.clear();
      else map.delete(key);
    },
    invalidateGroup(group) {
      for (const [k, e] of map) if (e.group === group) map.delete(k);
    },
    entries() {
      return [...map].map(([key, e]) => ({ key, status: e.status, expiresInMs: expiresIn(e), group: e.group }));
    },
  };
  return cache;
}

/** Khoá ổn định: cùng tham số khác thứ tự thuộc tính vẫn ra cùng khoá; bỏ các tham số không ảnh hưởng kết quả. */
export function stableKey(name: string, path: string, params: Record<string, unknown> = {}, ignore: string[] = []) {
  const sorted = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sorted)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted((v as Record<string, unknown>)[k])]))
        : v;
  const kept = Object.fromEntries(Object.entries(params).filter(([k]) => !ignore.includes(k)));
  return `${name}:${path}:${JSON.stringify(sorted(kept))}`;
}

// ───────────────────────── 2. Loader lười single-flight ─────────────────────────

/**
 * Tải một lần, dùng nhiều lần. Đang tải thì mọi người chờ chung một Promise.
 * Lỗi thì bỏ Promise để lần gọi sau thử lại (bản gốc giữ Promise lỗi mãi).
 */
export function createLazyLoader<T>(load: () => Promise<T>) {
  let promise: Promise<T> | null = null;
  let value: { v: T } | null = null;
  return {
    get(): Promise<T> {
      if (value) return Promise.resolve(value.v);
      if (!promise) {
        promise = load().then(
          (v) => {
            value = { v };
            return v;
          },
          (error: unknown) => {
            promise = null; // chỗ khác biệt với bản gốc
            throw error;
          },
        );
      }
      return promise;
    },
    get loaded() {
      return value != null;
    },
    reset() {
      promise = null;
      value = null;
    },
  };
}

// ───────────────────────── 3. Đua dữ liệu nhúng sẵn ─────────────────────────

/** Chỗ chứa dữ liệu server sẽ đẩy vào (vd từ một thẻ <script> cuối HTML), có thể tới trước hoặc sau. */
export interface PreloadSlot<T> {
  readonly state: 'waiting' | 'ready' | 'error';
  readonly value: T | undefined;
  /** gọi cb khi có dữ liệu (ngay nếu đã có); trả hàm huỷ */
  onReady(cb: (value: T) => void, onError?: (error: unknown) => void): () => void;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function createPreloadSlot<T>(): PreloadSlot<T> {
  let state: PreloadSlot<T>['state'] = 'waiting';
  let value: T | undefined;
  let error: unknown;
  const listeners = new Set<{ ok: (v: T) => void; err?: (e: unknown) => void }>();
  return {
    get state() {
      return state;
    },
    get value() {
      return value;
    },
    onReady(ok, err) {
      if (state === 'ready') ok(value as T);
      else if (state === 'error') err?.(error);
      else {
        const l = { ok, err };
        listeners.add(l);
        return () => listeners.delete(l);
      }
      return () => {};
    },
    resolve(v) {
      if (state !== 'waiting') return;
      state = 'ready';
      value = v;
      for (const l of listeners) l.ok(v);
      listeners.clear();
    },
    reject(e) {
      if (state !== 'waiting') return;
      state = 'error';
      error = e;
      for (const l of listeners) l.err?.(e);
      listeners.clear();
    },
  };
}

export type PreloadOutcome =
  | 'PRELOAD_HIT' // dữ liệu nhúng có sẵn hoặc tới trong lúc chờ, khớp request
  | 'PRELOAD_WON_RACE' // hết giờ chờ, đã gọi API, nhưng dữ liệu nhúng vẫn tới trước
  | 'CLIENT_WON_RACE' // API trả trước dữ liệu nhúng
  | 'MISMATCH' // dữ liệu nhúng tới nhưng thiếu thứ client cần
  | 'PRELOAD_ERROR';

export interface PreloadResult<T> {
  data: T;
  outcome: PreloadOutcome;
  /** có gọi API không (để đo request thừa) */
  fetched: boolean;
}

export interface PreloadOptions<T> {
  slot: PreloadSlot<T>;
  fetch: () => Promise<T>;
  /** chờ dữ liệu nhúng tối đa bao lâu trước khi tự gọi API (bản gốc: 2000 ms, GET có thể là 0) */
  waitMs?: number;
  /** dữ liệu nhúng có đủ cho request này không */
  matches?: (data: T) => boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export function preloadOrFetch<T>(opts: PreloadOptions<T>): Promise<PreloadResult<T>> {
  const {
    slot,
    fetch,
    waitMs = 2000,
    matches = () => true,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  } = opts;

  const viaApi = (outcome: PreloadOutcome) => fetch().then((data) => ({ data, outcome, fetched: true }));

  // 1. đã có sẵn
  if (slot.state === 'ready') return matches(slot.value as T) ? Promise.resolve({ data: slot.value as T, outcome: 'PRELOAD_HIT', fetched: false }) : viaApi('MISMATCH');
  if (slot.state === 'error') return viaApi('PRELOAD_ERROR');

  return new Promise<PreloadResult<T>>((resolve, reject) => {
    let done = false;
    const finish = (p: Promise<PreloadResult<T>> | PreloadResult<T>) => {
      if (done) return;
      done = true;
      Promise.resolve(p).then(resolve, reject);
    };
    // 2. chờ trong cửa sổ waitMs
    const cancel = slot.onReady(
      (data) => {
        clearTimer(timer);
        finish(matches(data) ? { data, outcome: 'PRELOAD_HIT', fetched: false } : viaApi('MISMATCH'));
      },
      () => {
        clearTimer(timer);
        finish(viaApi('PRELOAD_ERROR'));
      },
    );
    const timer = setTimer(() => {
      cancel();
      // 3. hết giờ: gọi API, nhưng dữ liệu nhúng tới trước (và khớp) thì vẫn dùng
      const api = fetch();
      let apiDone = false;
      api.then(
        (data) => {
          apiDone = true;
          finish({ data, outcome: 'CLIENT_WON_RACE', fetched: true });
        },
        (e) => finish(Promise.reject(e)),
      );
      slot.onReady((data) => {
        if (!apiDone && matches(data)) finish({ data, outcome: 'PRELOAD_WON_RACE', fetched: true });
      });
    }, waitMs);
  });
}

export interface RequestShape {
  path: string;
  method?: string;
  params?: Record<string, unknown>;
  fields?: string[];
}

/**
 * Request của client có được dữ liệu nhúng phục vụ không: cùng path, method, các tham số khác bằng nhau,
 * còn `fields` của client là tập con của `fields` server đã lấy. Trả danh sách chỗ lệch (rỗng = khớp).
 */
export function requestDeltas(client: RequestShape, server: RequestShape): string[] {
  const out: string[] = [];
  if (client.path !== server.path) out.push(`path ${client.path} ≠ ${server.path}`);
  if ((client.method ?? 'get') !== (server.method ?? 'get')) out.push('method');
  const sp = server.params ?? {};
  for (const [k, v] of Object.entries(client.params ?? {})) {
    if (JSON.stringify(v) !== JSON.stringify(sp[k])) out.push(`param ${k}`);
  }
  const have = new Set(server.fields ?? []);
  for (const f of client.fields ?? []) if (!have.has(f)) out.push(`field ${f}`);
  return out;
}

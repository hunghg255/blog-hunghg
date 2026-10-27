import { useEffect, useSyncExternalStore } from 'react';

/**
 * Cache chuẩn hoá (normalized) tự dọn bằng đếm tham chiếu.
 *
 * Ý tưởng từ QueryTracker của Outlook (owa-query-tracker): component mount thì "giữ" query,
 * unmount thì "nhả"; query hết người giữ thì CHỜ một lúc rồi mới xoá các field gốc của nó
 * khỏi cache và chạy gc() để dọn những entity không còn ai trỏ tới.
 */

export type Ref = { __ref: string };
type Entity = Record<string, unknown>;

const isRef = (v: unknown): v is Ref => typeof v === 'object' && v !== null && '__ref' in v;

export interface RefCountCacheOptions {
  /** chờ bao lâu sau khi query hết người giữ mới dọn (Outlook: 30 giây) */
  delayMs?: number;
  /** tiêm hàm hẹn giờ để test, mặc định setTimeout/clearTimeout */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

interface TrackedQuery {
  refs: number;
  fields: string[];
  timer?: unknown;
  /** thời điểm hẹn dọn, để demo hiển thị đếm ngược */
  cleanupAt?: number;
}

export function createRefCountCache({
  delayMs = 30_000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
}: RefCountCacheOptions = {}) {
  const roots = new Map<string, unknown>(); // field gốc, vd 'film({"id":"a"})'
  const entities = new Map<string, Entity>(); // vd 'Film:a', 'Person:7'
  const queries = new Map<string, TrackedQuery>();
  // số query (đang dùng HOẶC đang chờ dọn) có chọn field này
  const fieldOwners = new Map<string, number>();
  const inflight = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const log: string[] = [];
  let version = 0;

  const emit = (message?: string) => {
    version++;
    if (message) log.unshift(message);
    log.length = Math.min(log.length, 30);
    listeners.forEach((listener) => listener());
  };

  // ---- chuẩn hoá: object có __typename + id được tách ra thành entity, chỗ cũ thay bằng ref ----
  function normalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(normalize);
    if (typeof value !== 'object' || value === null) return value;
    const obj = value as Entity;
    const fields: Entity = {};
    for (const [k, v] of Object.entries(obj)) fields[k] = normalize(v);
    if (typeof obj.__typename === 'string' && obj.id != null) {
      const id = `${obj.__typename}:${obj.id}`;
      entities.set(id, { ...entities.get(id), ...fields });
      return { __ref: id };
    }
    return fields;
  }

  function denormalize(value: unknown, seen = new Set<string>()): unknown {
    if (Array.isArray(value)) return value.map((v) => denormalize(v, seen));
    if (isRef(value)) {
      if (seen.has(value.__ref)) return value; // vòng lặp tham chiếu
      const entity = entities.get(value.__ref);
      return entity && denormalize(entity, new Set(seen).add(value.__ref));
    }
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, denormalize(v, seen)]));
  }

  /** Đánh dấu mọi entity còn trỏ tới được từ field gốc, xoá phần còn lại. */
  function gc(): string[] {
    const reachable = new Set<string>();
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (isRef(value)) {
        if (reachable.has(value.__ref)) return;
        reachable.add(value.__ref);
        return visit(entities.get(value.__ref));
      }
      if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
    };
    roots.forEach(visit);
    const removed = [...entities.keys()].filter((id) => !reachable.has(id));
    removed.forEach((id) => entities.delete(id));
    return removed;
  }

  function cleanup(queryKey: string) {
    const query = queries.get(queryKey);
    if (!query || query.refs > 0) return;
    queries.delete(queryKey);

    const evicted: string[] = [];
    for (const field of query.fields) {
      const owners = (fieldOwners.get(field) ?? 1) - 1;
      if (owners > 0) {
        fieldOwners.set(field, owners); // query khác vẫn chọn field này
        continue;
      }
      fieldOwners.delete(field);
      if (roots.delete(field)) evicted.push(field);
    }
    const removed = evicted.length > 0 ? gc() : [];
    emit(`dọn ${queryKey}: xoá ${evicted.length} field gốc, gc xoá ${removed.length} entity`);
  }

  /** Giữ một query. Trả về hàm nhả, gọi nhiều lần cũng chỉ tính một. */
  function retain(queryKey: string, fieldKeys: string[]): () => void {
    let query = queries.get(queryKey);
    if (!query) {
      query = { refs: 0, fields: [...fieldKeys] };
      queries.set(queryKey, query);
      for (const field of query.fields) fieldOwners.set(field, (fieldOwners.get(field) ?? 0) + 1);
    }
    if (query.timer !== undefined) {
      // mount lại trong lúc đang chờ dọn: huỷ lịch, dữ liệu còn nguyên
      clearTimer(query.timer);
      query.timer = query.cleanupAt = undefined;
    }
    query.refs++;
    emit();

    const tracked = query;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      tracked.refs--;
      if (tracked.refs === 0) {
        tracked.cleanupAt = Date.now() + delayMs;
        tracked.timer = setTimer(() => cleanup(queryKey), delayMs);
      }
      emit();
    };
  }

  function write(fieldKey: string, value: unknown) {
    // Kết quả về muộn khi query đã bị dọn: bỏ đi, nếu không sẽ thành rác không ai dọn
    if (!fieldOwners.has(fieldKey)) return false;
    roots.set(fieldKey, normalize(value));
    emit(`ghi ${fieldKey}`);
    return true;
  }

  /** Tải field nếu cache chưa có; nhiều nơi gọi cùng lúc chỉ tạo một request. */
  function fetchOnce(fieldKey: string, fetcher: () => Promise<unknown>): Promise<void> {
    if (roots.has(fieldKey)) return Promise.resolve();
    let pending = inflight.get(fieldKey);
    if (!pending) {
      pending = fetcher()
        .then((value) => void write(fieldKey, value))
        .finally(() => inflight.delete(fieldKey));
      inflight.set(fieldKey, pending);
    }
    return pending;
  }

  const readCache = new Map<string, { version: number; value: unknown }>();
  /** Đọc field gốc đã ghép lại; trả cùng object nếu cache chưa đổi (cần cho useSyncExternalStore). */
  function read(fieldKey: string): unknown {
    const hit = readCache.get(fieldKey);
    if (hit?.version === version) return hit.value;
    const value = roots.has(fieldKey) ? denormalize(roots.get(fieldKey)) : undefined;
    readCache.set(fieldKey, { version, value });
    return value;
  }

  return {
    retain,
    write,
    read,
    fetchOnce,
    has: (fieldKey: string) => roots.has(fieldKey),
    gc,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getVersion: () => version,
    /** ảnh chụp trạng thái cho demo / debug */
    inspect: () => ({
      roots: [...roots.keys()],
      entities: [...entities.keys()],
      queries: [...queries.entries()].map(([key, q]) => ({ key, refs: q.refs, cleanupAt: q.cleanupAt })),
      log: [...log],
    }),
  };
}

export type RefCountCache = ReturnType<typeof createRefCountCache>;

/** Hook: giữ query trong lúc component còn mount, tải nếu cache chưa có. */
export function useRefCountedQuery<T>(
  cache: RefCountCache,
  queryKey: string,
  fieldKey: string,
  fetcher: () => Promise<unknown>,
): T | undefined {
  const value = useSyncExternalStore(cache.subscribe, () => cache.read(fieldKey));
  useEffect(() => {
    const release = cache.retain(queryKey, [fieldKey]);
    void cache.fetchOnce(fieldKey, fetcher);
    return release;
    // fetcher thường là hàm mới mỗi lần render, không đưa vào deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cache, queryKey, fieldKey]);
  return value as T | undefined;
}

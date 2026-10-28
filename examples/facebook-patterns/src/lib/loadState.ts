/**
 * Trạng thái tải bất biến có "interning", và bộ gom request kiểu DataLoader
 * (ý tưởng từ LoadObject + LoadObjectMap của Facebook).
 *
 * Interning: các trạng thái "rỗng phổ biến" (đang tải, chưa có gì, value = null/0/''…)
 * luôn trả về CÙNG một object. Nhờ vậy `prev === next` đúng, React.memo bỏ qua render,
 * và 10.000 ô đang "loading" chỉ tốn một object thay vì 10.000.
 */

export type Operation = 'loading' | 'creating' | 'updating' | 'deleting' | undefined;

export interface LoadState<T> {
  readonly operation: Operation;
  readonly value: T | undefined;
  readonly hasValue: boolean;
  readonly error: unknown;
}

// Facebook intern cho đúng tập này: undefined, null, false, true, 0, ''
const INTERNABLE = new Set<unknown>([undefined, null, false, true, 0, '']);
const pool = new Map<string, LoadState<never>>();

function make<T>(operation: Operation, value: T | undefined, hasValue: boolean, error: unknown): LoadState<T> {
  if (error === undefined && INTERNABLE.has(value)) {
    // khoá chuỗi phân biệt được 0/''/false/null/undefined nhờ typeof
    const key = `${operation}|${hasValue}|${typeof value}|${String(value)}`;
    let shared = pool.get(key);
    if (!shared) {
      shared = Object.freeze({ operation, value, hasValue, error }) as LoadState<never>;
      pool.set(key, shared);
    }
    return shared as LoadState<T>;
  }
  return Object.freeze({ operation, value, hasValue, error });
}

export const LoadState = {
  empty: <T>() => make<T>(undefined, undefined, false, undefined),
  loading: <T>() => make<T>('loading', undefined, false, undefined),
  withValue: <T>(value: T) => make<T>(undefined, value, true, undefined),
  withError: <T>(error: unknown) => make<T>(undefined, undefined, false, error),
  setOperation: <T>(s: LoadState<T>, op: Operation) => make(op, s.value, s.hasValue, s.error),
  done: <T>(s: LoadState<T>) => make(undefined, s.value, s.hasValue, s.error),
  /** số object đang nằm trong pool (để demo) */
  poolSize: () => pool.size,
};

// ---------------- bộ gom request ----------------

export interface BatchLoaderOptions<K, V> {
  /** tải một lô khoá, trả về Map khoá → giá trị (khoá thiếu = lỗi "not found") */
  loadMany: (keys: K[]) => Promise<Map<K, V>>;
  /** tối đa bao nhiêu khoá một request, mặc định không giới hạn */
  maxBatchSize?: number;
  /** 'microtask' gom trong cùng tick (DataLoader); 'timeout' dùng setTimeout(0) như Facebook */
  schedule?: 'microtask' | 'timeout';
  /** đổi khoá thành chuỗi để chống trùng, mặc định String(key) */
  cacheKey?: (key: K) => string;
}

export function createBatchLoader<K, V>({
  loadMany,
  maxBatchSize = Infinity,
  schedule = 'microtask',
  cacheKey = (k) => String(k),
}: BatchLoaderOptions<K, V>) {
  const cache = new Map<string, Promise<V>>();
  let queue: Array<{ key: K; resolve: (v: V) => void; reject: (e: unknown) => void }> = [];
  let scheduled = false;
  let requests = 0;

  const flush = () => {
    scheduled = false;
    const batch = queue;
    queue = [];
    for (let i = 0; i < batch.length; i += maxBatchSize) {
      const chunk = batch.slice(i, i + maxBatchSize);
      requests++;
      loadMany(chunk.map((item) => item.key)).then(
        (result) => {
          for (const item of chunk) {
            if (result.has(item.key)) item.resolve(result.get(item.key) as V);
            else item.reject(new Error(`not found: ${String(item.key)}`));
          }
        },
        (error) => {
          for (const item of chunk) {
            cache.delete(cacheKey(item.key)); // lỗi mạng: lần sau được thử lại
            item.reject(error);
          }
        },
      );
    }
  };

  return {
    load(key: K): Promise<V> {
      const id = cacheKey(key);
      const hit = cache.get(id);
      if (hit) return hit; // chống trùng: cùng khoá trong cùng lô (hoặc đã tải) dùng chung promise
      const promise = new Promise<V>((resolve, reject) => queue.push({ key, resolve, reject }));
      cache.set(id, promise);
      if (!scheduled) {
        scheduled = true;
        if (schedule === 'microtask') queueMicrotask(flush);
        else setTimeout(flush, 0);
      }
      return promise;
    },
    /** đánh dấu cũ: lần load sau sẽ gọi mạng lại (setKeyStale của Facebook) */
    markStale(key: K) {
      cache.delete(cacheKey(key));
    },
    get requestCount() {
      return requests;
    },
  };
}

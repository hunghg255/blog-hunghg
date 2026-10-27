/**
 * Gom nhiều yêu cầu lấy giá thành vài request theo lô (ý tưởng từ CoursePriceStore của Udemy),
 * và cập nhật MỘT PHẦN trang khi áp mã giảm giá (ý tưởng từ CourseLandingComponentsStore).
 *
 * Khác bản gốc:
 * - id có trong lô nhưng server không trả về thì báo lỗi, không treo "đang tải" mãi.
 * - Sắp id theo số (a - b) thay vì `.sort()` mặc định (so như chuỗi).
 * - `populate` chỉ nhận kết quả của lần gọi MỚI NHẤT: áp mã A rồi mã B nhanh, response A về
 *   muộn cũng không đè giá của B.
 */

export type LoadStatus = 'loading' | 'loaded' | 'error';

export interface Entry<V> {
  status: LoadStatus;
  value?: V;
  error?: string;
}

export interface BatchLoaderOptions<V> {
  /** Lấy một lô id. Trả về map id → giá trị; id nào thiếu sẽ bị coi là lỗi. */
  fetchBatch: (ids: number[]) => Promise<Record<number, V>>;
  /** Udemy: 10 id mỗi request. */
  maxBatchSize?: number;
  /** Udemy: chờ 250ms để gom các card mount gần nhau. */
  delay?: number;
}

export function createBatchLoader<V>({ fetchBatch, maxBatchSize = 10, delay = 250 }: BatchLoaderOptions<V>) {
  const entries = new Map<number, Entry<V>>();
  const listeners = new Set<() => void>();
  let queue: number[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let requests = 0;

  const notify = () => listeners.forEach((l) => l());
  const set = (id: number, entry: Entry<V>) => {
    entries.set(id, entry);
    notify();
  };

  function flush() {
    timer = null;
    // sắp theo số để cùng một tập id luôn ra cùng URL (dễ trúng cache CDN)
    const ids = [...new Set(queue)].sort((a, b) => a - b);
    queue = [];
    for (let i = 0; i < ids.length; i += maxBatchSize) {
      const batch = ids.slice(i, i + maxBatchSize);
      requests++;
      fetchBatch(batch).then(
        (result) => {
          for (const id of batch) {
            if (id in result) set(id, { status: 'loaded', value: result[id] });
            else set(id, { status: 'error', error: 'server không trả về id này' });
          }
        },
        (err: unknown) => {
          for (const id of batch) set(id, { status: 'error', error: String(err) });
        },
      );
    }
  }

  /** Đăng ký một id; đã có (và không lỗi) thì bỏ qua. `id` luôn được ép về số. */
  function load(rawId: number | string) {
    const id = Number(rawId);
    const current = entries.get(id);
    if (current && current.status !== 'error') return;
    set(id, { status: 'loading', value: current?.value });
    queue.push(id);
    timer ??= setTimeout(flush, delay);
  }

  return {
    load,
    /** Tải lại mọi id đang có (vd: sau khi áp mã giảm giá trong giỏ hàng). */
    reloadAll() {
      for (const id of [...entries.keys()]) {
        entries.set(id, { ...entries.get(id)!, status: 'error' });
        load(id);
      }
    },
    get: (id: number) => entries.get(Number(id)),
    stats: () => ({ requests, pending: queue.length }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reset() {
      if (timer) clearTimeout(timer);
      timer = null;
      queue = [];
      entries.clear();
      requests = 0;
      notify();
    },
  };
}

// ---------------------------------------------------------------- cập nhật một phần

export interface ComponentContextStoreOptions<C> {
  /** Lấy context cho một danh sách component, kèm tham số (vd: mã giảm giá). */
  fetchComponents: (names: string[], params: Record<string, string>) => Promise<Record<string, C>>;
  /** Bản gốc không có: bỏ qua response của lần gọi cũ hơn. */
  latestWins?: boolean;
}

export function createComponentContextStore<C>({ fetchComponents, latestWins = true }: ComponentContextStoreOptions<C>) {
  const contexts = new Map<string, C>();
  const listeners = new Map<string, Set<() => void>>();
  // mỗi tên component nhớ lần gọi mới nhất đã "giành quyền" ghi nó
  const owner = new Map<string, number>();
  let seq = 0;

  const notify = (name: string) => listeners.get(name)?.forEach((l) => l());

  return {
    get: (name: string) => contexts.get(name),
    /** Chỉ component có tên `name` được báo khi context của nó đổi. */
    subscribe(name: string, listener: () => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
      return () => listeners.get(name)!.delete(listener);
    },
    async populate(names: string[], params: Record<string, string> = {}) {
      const id = ++seq;
      names.forEach((n) => owner.set(n, id));
      const result = await fetchComponents(names, params);
      const applied: string[] = [];
      for (const name of names) {
        if (latestWins && owner.get(name) !== id) continue; // đã có lần gọi mới hơn
        contexts.set(name, result[name]);
        applied.push(name);
        notify(name);
      }
      return { applied, stale: names.length - applied.length };
    },
  };
}

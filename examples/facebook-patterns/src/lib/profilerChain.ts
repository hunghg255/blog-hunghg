/**
 * Profiler kiểu middleware, ý tưởng từ RelayProfiler (viết lại):
 * - instrument(name, fn) trả về wrapper; mỗi lần gọi, các handler được xâu thành chuỗi
 *   "*" (aggregate chung) → handler theo tên → handler gắn riêng cho wrapper, cuối cùng mới tới fn gốc,
 * - mỗi handler nhận (name, next) và phải gọi next() đúng một lần,
 * - tên bắt đầu bằng "@" thì không instrument (trả lại fn gốc).
 * Khác bản gốc: chặn next() gọi hai lần, dọn frame khi fn ném lỗi, chụp danh sách handler lúc gọi.
 */

export type Handler = (name: string, next: () => void) => void;
export type ProfileHandler = (name: string, state?: unknown) => ((error?: unknown) => void) | void;

export type Instrumented<F extends (...args: any[]) => any> = F & {
  attachHandler(h: Handler): void;
  detachHandler(h: Handler): void;
  displayName: string;
};

function remove<T>(list: T[], item: T) {
  const i = list.indexOf(item);
  if (i !== -1) list.splice(i, 1);
}

export function createProfiler() {
  const aggregate: Record<string, Handler[]> = { '*': [] };
  const profileHandlers: Record<string, ProfileHandler[]> = { '*': [] };
  const enabled = (name: string) => name.charAt(0) !== '@';

  function instrument<F extends (...args: any[]) => any>(name: string, fn: F): Instrumented<F> {
    if (!enabled(name)) {
      return Object.assign(fn, { attachHandler() {}, detachHandler() {}, displayName: name });
    }
    if (!aggregate[name]) aggregate[name] = [];
    const local: Handler[] = [];

    const wrapper = function (this: unknown, ...args: unknown[]) {
      // chụp danh sách lúc gọi; handler gắn sau cùng chạy ngoài cùng trong mỗi nhóm (giống bản gốc)
      const chain = [...aggregate['*']]
        .reverse()
        .concat([...aggregate[name]].reverse(), [...local].reverse());
      if (chain.length === 0) return fn.apply(this, args);
      let result: unknown;
      let ran = false;
      const step = (i: number) => {
        if (i === chain.length) {
          ran = true;
          result = fn.apply(this, args);
          return;
        }
        let called = false;
        chain[i](name, () => {
          if (called) throw new Error(`Profiler: handler #${i} của "${name}" gọi next() hai lần`);
          called = true;
          step(i + 1);
        });
        if (!called) throw new Error(`Profiler: handler #${i} của "${name}" không gọi next()`);
      };
      step(0); // lỗi từ fn hay từ handler đều đi thẳng ra ngoài, không để lại trạng thái
      if (!ran) throw new Error('Profiler: hàm gốc không được gọi');
      return result;
    } as unknown as Instrumented<F>;

    wrapper.attachHandler = (h) => void local.push(h);
    wrapper.detachHandler = (h) => remove(local, h);
    wrapper.displayName = `(instrumented ${name})`;
    return wrapper;
  }

  return {
    instrument,
    /** Bọc mọi method trong `names` của object. */
    instrumentMethods<T extends Record<string, any>>(obj: T, names: Record<string, string>) {
      for (const key of Object.keys(names)) {
        if (typeof obj[key] === 'function')
          (obj as Record<string, unknown>)[key] = instrument(names[key], obj[key]);
      }
    },
    attachAggregateHandler(name: string, h: Handler) {
      if (!enabled(name)) return;
      (aggregate[name] ??= []).push(h);
    },
    detachAggregateHandler(name: string, h: Handler) {
      if (aggregate[name]) remove(aggregate[name], h);
    },
    /** Đo một khoảng không gắn với hàm: start ngay, trả về stop(). Handler bắt đầu sau thì dừng trước. */
    profile(name: string, state?: unknown) {
      const list = [...(profileHandlers[name] ?? []), ...profileHandlers['*']];
      const stops: ((error?: unknown) => void)[] = [];
      for (let i = list.length - 1; i >= 0; i--) {
        const stop = list[i](name, state);
        if (typeof stop === 'function') stops.unshift(stop);
      }
      return { stop: (error?: unknown) => stops.forEach((s) => s(error)) };
    },
    attachProfileHandler(name: string, h: ProfileHandler) {
      if (!enabled(name)) return;
      (profileHandlers[name] ??= []).push(h);
    },
    detachProfileHandler(name: string, h: ProfileHandler) {
      if (profileHandlers[name]) remove(profileHandlers[name], h);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Memo selector có canary lấy mẫu (ý tưởng từ adsMemoizeSelectorGetStores) */

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) => Object.prototype.hasOwnProperty.call(b, k) && Object.is((a as any)[k], (b as any)[k]),
  );
}

export interface SelectorStats {
  calls: number;
  computed: number;
  canaryChecks: number;
  impureDetected: number;
}

export interface MemoOptions {
  name: string;
  /** người viết khẳng định hàm thuần (cùng đối số → cùng kết quả) */
  isPure: boolean;
  /** xác suất chạy lại hàm gốc để kiểm chứng, vd 0.001 */
  sampleRate: number;
  random?: () => number;
  onImpure?: (name: string) => void;
  /** đếm số lần gọi của selector không thuần, để báo cáo định kỳ */
  callCounter?: Map<string, number>;
}

/**
 * Selector thuần: memo theo identity của đối số (WeakMap cho object, nên không giữ object chết),
 * và thỉnh thoảng chạy lại hàm gốc để kiểm chứng. Selector không thuần: không memo, chỉ đếm lời gọi.
 */
export function memoizeSelector<A, R>(fn: (arg: A) => R, opts: MemoOptions) {
  const { name, isPure, sampleRate, random = Math.random, onImpure, callCounter } = opts;
  const stats: SelectorStats = { calls: 0, computed: 0, canaryChecks: 0, impureDetected: 0 };
  const weak = new WeakMap<object, R>();
  const strong = new Map<unknown, R>();
  let reported = false;

  const compute = (arg: A) => {
    stats.computed++;
    return fn(arg);
  };
  const selector = (arg: A): R => {
    stats.calls++;
    if (!isPure) {
      callCounter?.set(name, (callCounter.get(name) ?? 0) + 1);
      return compute(arg);
    }
    const isObj = (typeof arg === 'object' && arg !== null) || typeof arg === 'function';
    const cache = isObj ? weak : strong;
    const key = arg as unknown as object;
    if (!cache.has(key)) {
      if (!isObj && strong.size >= 100) strong.delete(strong.keys().next().value);
      cache.set(key, compute(arg));
      return cache.get(key)!;
    }
    const memo = cache.get(key)!;
    if (sampleRate > 0 && random() < sampleRate) {
      stats.canaryChecks++;
      if (!shallowEqual(memo, compute(arg))) {
        stats.impureDetected++;
        if (!reported) {
          reported = true; // báo một lần cho mỗi selector, tránh spam log
          onImpure?.(name);
        }
      }
    }
    return memo;
  };
  return Object.assign(selector, { stats });
}

/** Lấy các selector bị gọi > 1 lần kể từ lần trước rồi xoá bộ đếm (bản gốc gửi lên QPL mỗi 5 phút). */
export function flushImpureCounts(counter: Map<string, number>) {
  const out: Record<string, number> = {};
  counter.forEach((n, k) => {
    if (n > 1) out[k] = n;
  });
  counter.clear();
  return out;
}

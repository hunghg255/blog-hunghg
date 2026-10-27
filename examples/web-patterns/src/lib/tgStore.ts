import { useLayoutEffect, useReducer, useRef } from 'react';

/**
 * Store toàn cục tối giản theo ý tưởng teactn của Telegram Web A (lib/teact/teactn.tsx):
 * - `setGlobal` chỉ đổi tham chiếu state; việc báo cho component được gom lại, chạy
 *   MỘT lần trong requestAnimationFrame kế tiếp (nhiều action trong một frame = một lần tính lại).
 * - Mỗi component đăng ký một "container" với hàm `mapState`. Khi flush, chạy lại mọi
 *   mapState và so sánh nông (shallow) với kết quả cũ, chỉ component có props đổi mới render.
 * - Công cụ debug: cảnh báo mapState trả NaN, cảnh báo flush chậm, đếm số lần render.
 *
 * Khác bản gốc: một mapState ném lỗi không làm dừng việc cập nhật các container khác,
 * và id container không bị sinh lại ở mỗi lần render (xem bài viết).
 */

type Mapper<S, P> = (state: S) => P;

interface Container<S> {
  id: number;
  name: string;
  mapState: Mapper<S, Record<string, unknown>>;
  mapped: Record<string, unknown>;
  forceUpdate: () => void;
  updates: number;
}

export interface StoreDebugEvent {
  type: 'nan' | 'slow' | 'error' | 'flush';
  message: string;
}

export interface StoreOptions {
  /** ngưỡng cảnh báo flush chậm (ms), Telegram dùng 7ms */
  slowFlushMs?: number;
  /** nơi nhận cảnh báo debug, mặc định console.warn */
  onDebug?: (event: StoreDebugEvent) => void;
  /** hàm lên lịch flush, mặc định requestAnimationFrame (để test có thể truyền hàm đồng bộ) */
  schedule?: (cb: () => void) => void;
}

export function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  if (a === b) return true;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => Object.is(a[key], b[key]));
}

/** Liệt kê props khác nhau, để biết "vì sao component này render lại". */
export function diffProps(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((key) => !Object.is(a[key], b[key]));
}

export function createGlobalStore<S>(initial: S, options: StoreOptions = {}) {
  const {
    slowFlushMs = 7,
    onDebug = (event) => console.warn(`[store] ${event.message}`),
    schedule = (cb) => requestAnimationFrame(cb),
  } = options;

  let current = initial;
  let flushScheduled = false;
  let nextContainerId = 1;
  let flushCount = 0;
  const containers = new Map<number, Container<S>>();
  const listeners = new Set<() => void>();

  /**
   * Chạy mapState có bắt lỗi: lỗi trong một component không được làm sập cả app.
   * Chỉ báo lỗi khi flush; trong lúc render thì im lặng giữ props cũ (báo ở đó dễ thành vòng lặp
   * nếu chính việc báo lỗi làm component render lại).
   */
  function safeMap(container: Container<S>, report = false) {
    try {
      return container.mapState(current);
    } catch (error) {
      if (report) onDebug({ type: 'error', message: `${container.name}: mapState lỗi (${String(error)})` });
      return undefined;
    }
  }

  function flush() {
    flushScheduled = false;
    flushCount++;
    const startedAt = performance.now();

    for (const container of containers.values()) {
      const next = safeMap(container, true);
      // Bản gốc `return` ở đây, nên MỘT mapper lỗi làm mọi container phía sau không được cập nhật.
      if (!next) continue;

      if (Object.values(next).some((value) => Number.isNaN(value))) {
        // NaN !== NaN: store so sánh bằng !== (như bản gốc) sẽ render thừa mỗi lần flush.
        // shallowEqual ở đây dùng Object.is nên không bị, nhưng NaN thường là dấu hiệu tính sai.
        onDebug({ type: 'nan', message: `${container.name}: mapState trả về NaN (với so sánh !== sẽ render lại mỗi lần)` });
      }

      if (!shallowEqual(container.mapped, next)) {
        container.mapped = next;
        container.updates++;
        container.forceUpdate();
      }
    }

    const duration = performance.now() - startedAt;
    if (duration > slowFlushMs) {
      onDebug({ type: 'slow', message: `flush chậm: ${duration.toFixed(1)}ms cho ${containers.size} container` });
    }
    listeners.forEach((listener) => listener());
  }

  /**
   * Đổi state. Mặc định gom theo frame; `sync: true` flush ngay (Telegram dùng cho cử chỉ
   * vuốt back trên iOS, nơi giao diện phải đổi đồng bộ với animation của hệ điều hành).
   */
  function setGlobal(next: S, { sync = false } = {}) {
    if (next === current) return;
    current = next;
    if (sync) {
      flush();
      return;
    }
    if (!flushScheduled) {
      flushScheduled = true;
      schedule(flush);
    }
  }

  function getGlobal() {
    return current;
  }

  /** Tạo action: reducer nhận state hiện tại, trả state mới (hoặc undefined nếu không đổi). */
  function action<A extends unknown[]>(reducer: (state: S, ...args: A) => S | void) {
    return (...args: A) => {
      const next = reducer(current, ...args);
      if (next) setGlobal(next);
    };
  }

  /**
   * Hook nối component với store. `mapState` có thể là hàm inline: kết quả được so sánh nông,
   * nên trả về object mới mỗi lần cũng không sao, miễn các giá trị bên trong giữ tham chiếu.
   */
  function useGlobal<P extends Record<string, unknown>>(mapState: Mapper<S, P>, name = 'Component'): P {
    const [, forceUpdate] = useReducer((n: number) => n + 1, 0);
    const containerRef = useRef<Container<S> | null>(null);

    // Tạo container một lần cho mỗi instance. (Bản gốc gọi generateIdFor() ở mỗi lần render.)
    if (!containerRef.current) {
      containerRef.current = {
        id: nextContainerId++,
        name,
        mapState: mapState as Mapper<S, Record<string, unknown>>,
        mapped: {},
        forceUpdate,
        updates: 0,
      };
      containerRef.current.mapped = safeMap(containerRef.current) ?? {};
    }
    const container = containerRef.current;
    // Luôn dùng mapState mới nhất: nó có thể đóng gói props của component (vd. chatId), nên
    // khi component render lại vì props đổi thì phải tính lại (bản gốc làm khi ownProps đổi).
    if (container.mapState !== mapState) {
      container.mapState = mapState as Mapper<S, Record<string, unknown>>;
      const fresh = safeMap(container);
      if (fresh && !shallowEqual(container.mapped, fresh)) container.mapped = fresh;
    }

    useLayoutEffect(() => {
      containers.set(container.id, container);
      // state có thể đã đổi giữa lúc render và lúc đăng ký
      const latest = safeMap(container);
      if (latest && !shallowEqual(container.mapped, latest)) {
        container.mapped = latest;
        forceUpdate();
      }
      return () => {
        containers.delete(container.id);
      };
    }, [container]);

    return container.mapped as P;
  }

  /** Bảng "ai render bao nhiêu lần", giống double-click debug của Telegram. */
  function getRenderStats() {
    return [...containers.values()]
      .map(({ name, updates }) => ({ name, updates }))
      .sort((a, b) => b.updates - a.updates);
  }

  return {
    getGlobal,
    setGlobal,
    action,
    useGlobal,
    getRenderStats,
    getFlushCount: () => flushCount,
    /** gọi sau mỗi lần flush (dùng cho công cụ debug, devtools) */
    onFlush(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type GlobalStore<S> = ReturnType<typeof createGlobalStore<S>>;

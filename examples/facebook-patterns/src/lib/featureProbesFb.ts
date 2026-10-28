/**
 * Mô phỏng hành vi bản gốc để demo so sánh (viết lại theo hành vi đọc được):
 * - UserTimingUtils: gọi performance.measure('__v3', {}) trước khi dựng PerformanceMark,
 *   finally chỉ clearMarks nên measure '__v3' nằm lại trong timeline;
 * - FBScrollbarsUtils.canHideScrollbars bọc trong once(): lần gọi đầu chưa có body thì false mãi;
 * - addScrollingContainerResizeObserver: remove() unobserve cả phần tử, không xoá callback khỏi map.
 */

export function legacyMarkProbe(): { supported: boolean; leftover: number } {
  let supported = false;
  if (typeof PerformanceMark === 'function') {
    const opts = Object.defineProperty({}, 'startTime', {
      get() {
        supported = true;
        return undefined;
      },
    });
    try {
      performance.measure('__v3', {});
      new PerformanceMark('__v3', opts as PerformanceMarkOptions);
    } catch {
      /* L2 */
    } finally {
      performance.clearMarks('__v3');
    }
  }
  return { supported, leftover: performance.getEntriesByName('__v3', 'measure').length };
}

/** once(): nhớ kết quả lần đầu, kể cả false. */
export function once<T>(fn: () => T): () => T {
  let f: (() => T) | null = fn;
  let result: T;
  return () => {
    if (f) {
      result = f();
      f = null;
    }
    return result;
  };
}

export function fbResizeRegistry() {
  const callbacks = new Map<string, () => void>(); // khoá [el, hướng] ghép thành chuỗi cho gọn
  const ids = new WeakMap<Element, number>();
  let nextId = 0;
  const idOf = (el: Element) => {
    if (!ids.has(el)) ids.set(el, nextId++);
    return ids.get(el)!;
  };
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      callbacks.get(`${idOf(e.target)}:vertical`)?.();
      callbacks.get(`${idOf(e.target)}:horizontal`)?.();
    }
  });
  return {
    observe(el: Element, dir: 'vertical' | 'horizontal', cb: () => void) {
      ro.observe(el);
      callbacks.set(`${idOf(el)}:${dir}`, cb);
      return { remove: () => ro.unobserve(el) };
    },
    get size() {
      return callbacks.size;
    },
    disconnect: () => ro.disconnect(),
  };
}

/**
 * Debounce mà thời gian chờ là HÀM của tham số, viết lại từ Trello
 * (`packages/time/src/dynamicDebounce.ts`).
 *
 * Trello dùng ở ô tìm board: query ≤ 3 ký tự hoặc người dùng đang xoá lùi (query mới là
 * tiền tố của query cũ) thì chờ 1000ms, còn lại 500ms.
 *
 * Sửa so với bản gốc: với `leading: true`, bản gốc vẫn hẹn lần gọi cuối (trailing) nhưng đã
 * xoá `args`, nên lần gọi đó chạy với tham số `null`. Ở đây trailing chỉ chạy khi có ít nhất
 * một lần gọi nữa trong lúc chờ, và luôn chạy với tham số của lần gọi cuối cùng.
 */
export type WaitFn<A extends unknown[]> = (...args: A) => number;

export interface Debounced<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
  /** chạy ngay lần đang chờ (nếu có) */
  flush(): void;
  pending(): boolean;
}

export function dynamicDebounce<A extends unknown[]>(
  fn: (...args: A) => void,
  wait: number | WaitFn<A>,
  { leading = false }: { leading?: boolean } = {},
): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const run = () => {
    timer = undefined;
    if (lastArgs) {
      const args = lastArgs;
      lastArgs = undefined;
      fn(...args);
    }
  };

  const debounced = ((...args: A) => {
    const delay = typeof wait === 'function' ? wait(...args) : wait;
    const isFirst = timer === undefined;
    clearTimeout(timer);
    if (leading && isFirst) {
      fn(...args); // chạy ngay, KHÔNG giữ lại args cho trailing
    } else {
      lastArgs = args;
    }
    timer = setTimeout(run, delay);
  }) as Debounced<A>;

  debounced.cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    lastArgs = undefined;
  };
  debounced.flush = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    run();
  };
  debounced.pending = () => timer !== undefined && lastArgs !== undefined;
  return debounced;
}

/** Quy tắc chờ của ô tìm board trên Trello, nhận thêm danh sách query đã gõ trước đó. */
export function trelloSearchWait(pastQueries: string[]) {
  return (query: string) => {
    if (pastQueries.some((past) => past.startsWith(query))) return 1000; // có lẽ đang xoá lùi
    return query.length <= 3 ? 1000 : 500;
  };
}

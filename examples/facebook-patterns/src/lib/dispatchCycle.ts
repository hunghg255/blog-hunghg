/**
 * Dispatcher kiểu Flux có waitFor (ý tưởng từ AdsDispatchCycle của Facebook Ads Manager):
 * - Mỗi lần dispatch là một "chu kỳ": mọi callback ở trạng thái pending → started → complete.
 * - Callback gọi waitFor(...) để bắt callback khác chạy trước (store B cần số liệu mới của store A).
 * - Gặp lại callback đang "started" nghĩa là phụ thuộc vòng: báo lỗi kèm cả chuỗi.
 * Khác bản gốc: try/finally nên callback ném lỗi không để chu kỳ kẹt; dispatch lồng nhau được
 * xếp hàng thay vì chạy chen; luôn đo thời gian từng callback.
 */

type State = 'pending' | 'started' | 'complete';

export interface DispatchCycle<P> {
  readonly payload: P;
  /** chạy (nếu chưa) các callback theo tên, ngay bây giờ, trước khi tiếp tục */
  waitFor(...names: string[]): void;
}

export type DispatchCallback<P> = (payload: P, cycle: DispatchCycle<P>) => void;

export interface DispatchTiming {
  name: string;
  ms: number;
}

export class CycleError extends Error {
  constructor(readonly chain: string[]) {
    super(`Phụ thuộc vòng trong dispatch: ${chain.join(' → ')}`);
    this.name = 'CycleError';
  }
}

export function createDispatcher<P>(
  options: { now?: () => number; onCycle?: (t: DispatchTiming[], payload: P) => void } = {},
) {
  const now = options.now ?? (() => performance.now());
  const callbacks = new Map<string, DispatchCallback<P>>();
  const queue: P[] = [];
  let dispatching = false;

  function runCycle(payload: P) {
    const state = new Map<string, State>();
    for (const name of callbacks.keys()) state.set(name, 'pending');
    const stack: string[] = []; // các callback đang chạy dở, để in chuỗi khi gặp vòng
    const timings: DispatchTiming[] = [];

    const run = (name: string) => {
      const current = state.get(name);
      if (current === undefined) throw new Error(`waitFor: không có callback "${name}"`);
      if (current === 'complete') return;
      if (current === 'started') throw new CycleError([...stack.slice(stack.indexOf(name)), name]);
      state.set(name, 'started');
      stack.push(name);
      const start = now();
      try {
        callbacks.get(name)!(payload, cycle);
      } finally {
        // lỗi hay không, chu kỳ cũng phải về trạng thái nhất quán
        timings.push({ name, ms: now() - start });
        stack.pop();
        state.set(name, 'complete');
      }
    };

    const cycle: DispatchCycle<P> = {
      payload,
      waitFor: (...names) => names.forEach(run),
    };
    for (const name of callbacks.keys()) run(name);
    options.onCycle?.(timings, payload);
    return timings;
  }

  return {
    register(name: string, callback: DispatchCallback<P>) {
      if (callbacks.has(name)) throw new Error(`callback "${name}" đã có`);
      callbacks.set(name, callback);
      return () => void callbacks.delete(name);
    },
    /**
     * Dispatch trong lúc đang dispatch (callback phát action mới) được xếp hàng, chạy sau khi
     * chu kỳ hiện tại xong, để mọi store thấy action theo cùng một thứ tự.
     */
    dispatch(payload: P) {
      queue.push(payload);
      if (dispatching) return;
      dispatching = true;
      try {
        while (queue.length) runCycle(queue.shift()!);
      } finally {
        dispatching = false;
        queue.length = 0;
      }
    },
    get isDispatching() {
      return dispatching;
    },
  };
}

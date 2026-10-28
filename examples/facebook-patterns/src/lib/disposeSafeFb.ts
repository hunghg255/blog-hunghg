/**
 * Mô phỏng hành vi bản gốc để demo so sánh (viết lại theo hành vi đọc được, không phải mã gốc).
 */
import { useEffect, useMemo, useRef } from 'react';
import { browserIdle, throttle, type IdleApi, type Subscribable } from './disposeSafe';

type Fn = () => void;

/** GHLAriaLabelTracker.onAdd: dispose = splice(indexOf(fn), 1). Gọi lần hai: indexOf = -1, splice(-1, 1) xoá phần tử cuối. */
export function fbSpliceList() {
  const list: Fn[] = [];
  return {
    add(fn: Fn) {
      list.push(fn);
      return { dispose: () => void list.splice(list.indexOf(fn), 1) };
    },
    names: () => list.map((f) => f.name),
  };
}

/** GHLInternalMonitorStore.observeAny: dispose = filter(b => b === a), điều kiện ngược. */
export function fbFilterList() {
  let list: Fn[] = [];
  return {
    add(fn: Fn) {
      list.push(fn);
      return { dispose: () => void (list = list.filter((b) => b === fn)) };
    },
    names: () => list.map((f) => f.name),
  };
}

/** SetIdleTimeoutAcrossTransitions: set(timeoutId, idleId) nhưng khi chạy xong lại delete(idleId). */
export function fbIdleTimeouts(idle: IdleApi = browserIdle) {
  const map = new Map<number, number>();
  return {
    start(fn: Fn, ms: number) {
      const t = window.setTimeout(() => {
        const i = idle.request(() => {
          fn();
          map.delete(i); // khoá sai
        });
        map.set(t, i);
      }, ms);
      return t;
    },
    clear(t: number) {
      window.clearTimeout(t);
      const i = map.get(t);
      if (i !== undefined) {
        idle.cancel(i);
        map.delete(t);
      }
    },
    get pending() {
      return map.size;
    },
  };
}

/** UFI2SubscriptionManager: dispose không huỷ idle callback; unsubscribeAll không xoá tập handle. */
export class FbIdleSubscriptions {
  private subs = new Set<Subscribable>();
  private handles = new Set<number>();
  private active = false;

  constructor(private readonly idle: IdleApi = browserIdle) {}

  add(sub: Subscribable) {
    this.subs.add(sub);
    if (this.active) sub.subscribe();
    return {
      dispose: () => {
        sub.unsubscribe();
        this.subs.delete(sub);
      },
    };
  }

  activate() {
    if (this.active) return;
    this.active = true;
    for (const sub of this.subs) {
      let h: number | null = null;
      h = this.idle.request(() => {
        if (h !== null) this.handles.delete(h);
        if (this.active) sub.subscribe(); // không hỏi sub còn trong tập không
      });
      this.handles.add(h);
    }
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    for (const h of this.handles) this.idle.cancel(h); // huỷ nhưng không xoá khỏi tập
    for (const sub of this.subs) sub.unsubscribe();
  }

  get handleCount() {
    return this.handles.size;
  }
}

/** useThrottledComet: useEffect(() => { t.cancel() }, []) chạy lúc mount, không trả cleanup. */
export function useThrottledFb<A extends unknown[]>(fn: (...args: A) => void, wait = 100) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  const t = useMemo(() => throttle((...args: A) => ref.current(...args), wait), [wait]);
  useEffect(() => {
    t.cancel();
  }, [t]);
  return t;
}

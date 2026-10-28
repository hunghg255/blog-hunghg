/**
 * Dispose cho đúng: danh sách listener gỡ hai lần không hại ai, timer idle không để rác trong Map,
 * subscription bị huỷ trước khi kịp mở thì không mở nữa, throttle huỷ khi unmount, gom cleanup.
 * Sửa các bug đọc được trong GHLAriaLabelTracker, GHLInternalMonitorStore, SetIdleTimeoutAcrossTransitions,
 * UFI2SubscriptionManager / useCometUFISubscriptionManager, useCometLoadingStateTracker, useThrottledComet
 * (Facebook). Viết lại từ đầu.
 */
import { useEffect, useMemo, useRef } from 'react';

export interface Disposable {
  dispose(): void;
}

/** Bọc một hàm dọn dẹp cho nó chỉ chạy một lần, dù bị gọi bao nhiêu lần. */
export function disposeOnce(fn: () => void): Disposable {
  let done = false;
  return {
    dispose() {
      if (done) return;
      done = true;
      fn();
    },
  };
}

// ---------- 1. Danh sách listener ----------

/**
 * Mỗi lần add tạo một entry riêng (thêm cùng một hàm hai lần là hai entry),
 * dispose xoá đúng entry đó và chỉ một lần.
 */
export function createListenerSet<A extends unknown[] = []>() {
  const entries = new Set<{ fn: (...args: A) => void }>();
  return {
    add(fn: (...args: A) => void): Disposable {
      const entry = { fn };
      entries.add(entry);
      return disposeOnce(() => entries.delete(entry));
    },
    emit(...args: A) {
      // chụp danh sách trước khi phát; entry bị gỡ giữa chừng thì bỏ qua
      for (const e of [...entries]) if (entries.has(e)) e.fn(...args);
    },
    get size() {
      return entries.size;
    },
    names(): string[] {
      return [...entries].map((e) => e.fn.name || '?');
    },
  };
}

// ---------- 2. setTimeout rồi requestIdleCallback ----------

export interface IdleApi {
  request(cb: () => void): number;
  cancel(handle: number): void;
}

/** requestIdleCallback nếu có (Safari chưa có), không thì setTimeout. */
export const browserIdle: IdleApi =
  typeof requestIdleCallback === 'function'
    ? { request: (cb) => requestIdleCallback(() => cb()), cancel: (h) => cancelIdleCallback(h) }
    : { request: (cb) => window.setTimeout(cb, 1), cancel: (h) => window.clearTimeout(h) };

/** Chờ `ms` rồi chờ thêm lúc trình duyệt rảnh mới chạy. clear() huỷ được ở cả hai giai đoạn. */
export function createIdleTimeouts(idle: IdleApi = browserIdle) {
  const idleOf = new Map<number, number>(); // timeoutId → idleId, chỉ khi đang chờ idle
  return {
    start(fn: () => void, ms: number): number {
      const timeoutId = window.setTimeout(() => {
        idleOf.set(timeoutId, idle.request(() => {
          idleOf.delete(timeoutId); // xoá bằng đúng khoá đã set
          fn();
        }));
      }, ms);
      return timeoutId;
    },
    clear(timeoutId: number) {
      window.clearTimeout(timeoutId);
      const idleId = idleOf.get(timeoutId);
      if (idleId !== undefined) {
        idle.cancel(idleId);
        idleOf.delete(timeoutId);
      }
    },
    get pending() {
      return idleOf.size;
    },
  };
}

// ---------- 3. Subscription bật khi rảnh ----------

export interface Subscribable {
  subscribe(): void;
  unsubscribe(): void;
}

interface Slot {
  idle: number | null;
  subscribed: boolean;
}

/**
 * Giữ các subscription realtime (comment, reaction) của một story.
 * activate(): mở từng cái lúc trình duyệt rảnh. deactivate(): huỷ hết, kể cả cái đang chờ.
 * dispose của từng cái huỷ luôn lịch đang chờ của nó.
 */
export class IdleSubscriptions {
  private slots = new Map<Subscribable, Slot>();
  private active = false;

  constructor(private readonly idle: IdleApi = browserIdle) {}

  add(sub: Subscribable): Disposable {
    const slot: Slot = { idle: null, subscribed: false };
    this.slots.set(sub, slot);
    if (this.active) this.open(sub, slot);
    return disposeOnce(() => {
      if (this.slots.get(sub) !== slot) return;
      this.close(sub, slot);
      this.slots.delete(sub);
    });
  }

  activate() {
    if (this.active) return;
    this.active = true;
    for (const [sub, slot] of this.slots) {
      slot.idle = this.idle.request(() => {
        slot.idle = null;
        if (this.active && this.slots.get(sub) === slot) this.open(sub, slot);
      });
    }
  }

  deactivate() {
    if (!this.active) return;
    this.active = false;
    for (const [sub, slot] of this.slots) this.close(sub, slot);
  }

  get pendingCount() {
    let n = 0;
    for (const s of this.slots.values()) if (s.idle !== null) n++;
    return n;
  }

  private open(sub: Subscribable, slot: Slot) {
    if (slot.subscribed) return;
    slot.subscribed = true;
    sub.subscribe();
  }

  private close(sub: Subscribable, slot: Slot) {
    if (slot.idle !== null) {
      this.idle.cancel(slot.idle);
      slot.idle = null;
    }
    if (slot.subscribed) {
      slot.subscribed = false;
      sub.unsubscribe();
    }
  }
}

// ---------- 4. Gom cleanup, throttle trong React ----------

/** Gom hàm dọn dẹp, chạy ngược thứ tự thêm (giống DisposableStack), lỗi không chặn cái sau. */
export class CleanupBag {
  private fns: Array<() => void> = [];

  add(fn: (() => void) | null | undefined) {
    if (fn) this.fns.push(fn);
    return this;
  }

  get size() {
    return this.fns.length;
  }

  disposeAll() {
    const errors: unknown[] = [];
    for (const fn of this.fns.splice(0).reverse()) {
      try {
        fn();
      } catch (e) {
        errors.push(e);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Cleanup lỗi');
  }
}

export interface Throttled<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/** Throttle leading + trailing: chạy ngay lần đầu, lần cuối trong cửa sổ chạy khi hết `wait`. */
export function throttle<A extends unknown[]>(fn: (...args: A) => void, wait: number): Throttled<A> {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;
  const run = (args: A) => {
    last = Date.now();
    fn(...args);
  };
  const t = ((...args: A) => {
    const left = wait - (Date.now() - last);
    if (left <= 0 && !timer) return run(args);
    pending = args;
    timer ??= setTimeout(() => {
      timer = null;
      const a = pending;
      pending = null;
      if (a) run(a);
    }, Math.max(0, left));
  }) as Throttled<A>;
  t.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = null;
  };
  return t;
}

/** Hook throttle: luôn gọi bản fn mới nhất, huỷ lời gọi còn treo khi unmount (hoặc khi đổi wait). */
export function useThrottledCallback<A extends unknown[]>(fn: (...args: A) => void, wait = 100): Throttled<A> {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  }, [fn]);
  const throttled = useMemo(() => throttle((...args: A) => ref.current(...args), wait), [wait]);
  useEffect(() => () => throttled.cancel(), [throttled]); // trả về cleanup, không gọi cancel lúc mount
  return throttled;
}

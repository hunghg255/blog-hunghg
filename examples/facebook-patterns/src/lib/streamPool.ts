/**
 * Bộ đệm sắp lại chunk của stream theo số thứ tự và phát lại cho người đăng ký muộn
 * (ý tưởng từ RelayAsyncStreamPool của Facebook: dữ liệu @defer/@stream của GraphQL
 * có thể về lệch thứ tự, UI vẫn phải nhận đúng thứ tự).
 *
 * Khác bản gốc (xem bài viết):
 * - lỗi/complete đúng lượt vẫn được xử lý khi đã có complete "đến sớm" đang chờ
 *   (bản gốc bỏ qua, stream treo mãi);
 * - gọi start() TRƯỚC khi phát lại sự kiện cũ cho observer;
 * - dọn pending sau khi xả.
 */

export interface StreamObserver<T> {
  start?(sub: { unsubscribe(): void }): void;
  next(value: T): void;
  error(err: unknown): void;
  complete(): void;
}

type Event<T> = { kind: 'next'; data: T } | { kind: 'error'; error: unknown } | { kind: 'complete' };

interface Stream<T> {
  done: boolean;
  events: Event<T>[];
  pending: Map<number, Event<T>>;
  observers: Map<number, StreamObserver<T>>;
}

export class StreamPool<T> {
  private streams = new Map<string, Stream<T>>();
  private nextObserverId = 0;
  /** mô phỏng hành vi bản gốc để so sánh trong demo */
  constructor(private readonly options: { originalBehavior?: boolean } = {}) {}

  private get(id: string): Stream<T> {
    let s = this.streams.get(id);
    if (!s) {
      s = { done: false, events: [], pending: new Map(), observers: new Map() };
      this.streams.set(id, s);
    }
    return s;
  }

  private deliver(s: Stream<T>, ev: Event<T>) {
    s.events.push(ev);
    const observers = [...s.observers.values()];
    if (ev.kind !== 'next') {
      s.done = true;
      s.observers.clear();
      s.pending.clear();
    }
    for (const o of observers) {
      if (ev.kind === 'next') o.next(ev.data);
      else if (ev.kind === 'error') o.error(ev.error);
      else o.complete();
    }
  }

  /** Nhận sự kiện có số thứ tự `seq`. Đúng lượt thì phát và xả tiếp các sự kiện chờ liền sau. */
  push(id: string, seq: number, ev: Event<T>) {
    if (!Number.isInteger(seq) || seq < 0) throw new Error(`seq không hợp lệ: ${seq}`);
    const s = this.get(id);
    if (s.done) return;
    // Bản gốc: error()/complete() return ngay khi status = "có complete đang chờ".
    if (this.options.originalBehavior && ev.kind !== 'next' && s.pending.size > 0 &&
        [...s.pending.values()].some((p) => p.kind !== 'next')) return;
    const expected = s.events.length;
    if (seq < expected || s.pending.has(seq)) throw new Error(`seq ${seq} bị trùng`);
    if (seq > expected) {
      s.pending.set(seq, ev);
      return;
    }
    this.deliver(s, ev);
    for (let k = seq + 1; !s.done && s.pending.has(k); k++) {
      const next = s.pending.get(k)!;
      s.pending.delete(k);
      this.deliver(s, next);
    }
  }

  next(id: string, seq: number, data: T) {
    this.push(id, seq, { kind: 'next', data });
  }
  error(id: string, seq: number, error: unknown) {
    this.push(id, seq, { kind: 'error', error });
  }
  complete(id: string, seq: number) {
    this.push(id, seq, { kind: 'complete' });
  }

  /** Đăng ký: nhận lại mọi sự kiện đã phát (đúng thứ tự), rồi nhận tiếp sự kiện mới. */
  subscribe(id: string, observer: StreamObserver<T>) {
    const s = this.get(id);
    const key = this.nextObserverId++;
    const sub = { unsubscribe: () => s.observers.delete(key) };
    const replay = () => {
      for (const ev of s.events) {
        if (ev.kind === 'next') observer.next(ev.data);
        else if (ev.kind === 'error') observer.error(ev.error);
        else observer.complete();
      }
    };
    if (this.options.originalBehavior) {
      // bản gốc: phát lại trước rồi mới start(), và vẫn thêm observer vào stream đã đóng
      replay();
      s.observers.set(key, observer);
      observer.start?.(sub);
    } else {
      observer.start?.(sub);
      replay();
      if (!s.done) s.observers.set(key, observer);
    }
    return sub;
  }

  /** Số sự kiện đang chờ (để demo thấy pending được dọn). */
  pendingCount(id: string) {
    return this.streams.get(id)?.pending.size ?? 0;
  }
  isDone(id: string) {
    return this.streams.get(id)?.done ?? false;
  }
  clear(id: string) {
    this.streams.delete(id);
  }
}

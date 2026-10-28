/**
 * Tải một byte range qua HTTP Range, tạm dừng được và tải tiếp đúng byte còn thiếu.
 * Ý tưởng học từ oz-player (OzPausableRangeStream, OzDeferredBuffer, OzByteRange,
 * getOzSegmentStreamableRange) của Facebook, viết lại từ đầu.
 */

/** Khoảng byte, `end` tính cả byte cuối; null nghĩa là "tới hết file". */
export interface ByteRange {
  start: number;
  end: number | null;
}

export const rangeLength = (r: ByteRange) => (r.end == null ? null : r.end - r.start + 1);
export const rangeHeader = (r: ByteRange) => `bytes=${r.start}-${r.end ?? ''}`;
/** `next` bắt đầu ngay sau byte cuối của `prev`. */
export const isRightAfter = (next: ByteRange, prev: ByteRange) => prev.end != null && next.start === prev.end + 1;

export interface RangedItem {
  url: string;
  range: ByteRange;
}

/** Gom các segment liền nhau (cùng URL, byte nối tiếp) thành ít request nhất, giữ thứ tự. */
export function groupContiguous<T extends RangedItem>(items: T[]): { url: string; range: ByteRange; items: T[] }[] {
  const out: { url: string; range: ByteRange; items: T[] }[] = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last.url === it.url && isRightAfter(it.range, last.range)) {
      last.range = { start: last.range.start, end: it.range.end };
      last.items.push(it);
    } else {
      out.push({ url: it.url, range: { ...it.range }, items: [it] });
    }
  }
  return out;
}

const END = Symbol('end');
type QueueItem = Uint8Array | Error | typeof END;

/**
 * Hàng đợi giữa phía nhận (mạng) và phía đọc. Đọc bằng con trỏ đầu thay vì shift() O(n),
 * và thu gọn mảng khi phần đã đọc chiếm quá nửa. Chunk lớn hơn `max` được cắt bằng subarray (không chép).
 */
export class ByteQueue {
  private items: (QueueItem | undefined)[] = [];
  private head = 0;
  private wake: (() => void) | null = null;

  push(item: Uint8Array | Error) {
    this.items.push(item);
    this.notify();
  }

  end() {
    this.items.push(END);
    this.notify();
  }

  get pending() {
    return this.items.length - this.head;
  }

  /** Lấy tối đa `max` byte; chờ nếu hàng rỗng. Trả null khi đã hết dữ liệu. */
  async take(max = Infinity): Promise<Uint8Array | null> {
    while (this.pending === 0) await new Promise<void>((r) => (this.wake = r));
    const item = this.items[this.head]!;
    if (item === END) return null;
    if (item instanceof Error) {
      this.advance();
      throw item;
    }
    if (item.length > max) {
      this.items[this.head] = item.subarray(max);
      return item.subarray(0, max);
    }
    this.advance();
    return item;
  }

  private advance() {
    this.items[this.head++] = undefined; // nhả tham chiếu tới chunk đã đọc
    if (this.head > 32 && this.head * 2 > this.items.length) {
      this.items = this.items.slice(this.head);
      this.head = 0;
    }
  }

  private notify() {
    const w = this.wake;
    this.wake = null;
    w?.();
  }
}

export type RangeFetcher = (range: ByteRange, signal: AbortSignal) => Promise<{ status: number; body: ReadableStream<Uint8Array> }>;

export type RangeEvent =
  | { type: 'request'; range: ByteRange; attempt: number }
  | { type: 'response'; status: number; skip: number; attempt: number }
  | { type: 'paused'; received: number }
  | { type: 'done'; received: number }
  | { type: 'network-error'; message: string; received: number };

/** 'error' là lỗi mạng: dữ liệu đã nhận vẫn giữ, gọi start() lần nữa để tải tiếp. */
export type StartResult = 'done' | 'paused' | 'error';

/** Fetcher ném lỗi này khi không nên thử lại (ví dụ ETag đổi: file trên server đã khác). */
export class RangeFatalError extends Error {
  override name = 'RangeFatalError';
}

export class PausableRangeStream {
  readonly readable: ReadableStream<Uint8Array>;
  private readonly queue = new ByteQueue();
  private received = 0;
  private wasted = 0;
  private attempt = 0;
  private controller: AbortController | null = null;
  private started = false;
  private finished = false;
  private failed = false;

  constructor(
    private range: ByteRange,
    private readonly fetcher: RangeFetcher,
    private readonly onEvent: (e: RangeEvent) => void = () => {},
  ) {
    this.readable = new ReadableStream<Uint8Array>({
      pull: async (c) => {
        try {
          const chunk = await this.queue.take();
          if (chunk) c.enqueue(chunk);
          else c.close();
        } catch (e) {
          c.error(e);
        }
      },
      cancel: () => this.pause(),
    });
  }

  get byteRange(): ByteRange {
    return { ...this.range };
  }

  get stats() {
    return { received: this.received, wasted: this.wasted, finished: this.finished };
  }

  /** Nới range để gộp segment liền sau, chỉ khi chưa gửi request nào. */
  tryExtend(next: ByteRange): boolean {
    if (this.started || !isRightAfter(next, this.range)) return false;
    this.range = { start: this.range.start, end: next.end };
    return true;
  }

  /** Gửi request cho phần còn thiếu: từ start + số byte đã nhận. */
  async start(): Promise<StartResult> {
    if (this.failed) return 'error';
    if (this.finished) return 'done';
    this.started = true;
    this.controller?.abort();
    const id = ++this.attempt;
    const controller = (this.controller = new AbortController());
    const from = this.range.start + this.received;
    const total = rangeLength(this.range);
    const req = { start: from, end: this.range.end };
    this.onEvent({ type: 'request', range: req, attempt: id });
    try {
      const res = await this.fetcher(req, controller.signal);
      if (id !== this.attempt) {
        void res.body.cancel().catch(() => {});
        return 'paused'; // pause() được gọi trong lúc chờ header
      }
      if (res.status !== 200 && res.status !== 206) throw new Error(`HTTP ${res.status}`);
      // 200 nghĩa là server bỏ qua Range và gửi cả file từ byte 0: bỏ đúng `from` byte đầu.
      let skip = res.status === 200 ? from : 0;
      this.onEvent({ type: 'response', status: res.status, skip, attempt: id });
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (id !== this.attempt) {
          void reader.cancel().catch(() => {});
          return 'paused';
        }
        if (done) break;
        let chunk = value;
        if (skip > 0) {
          const n = Math.min(skip, chunk.length);
          skip -= n;
          this.wasted += n;
          chunk = chunk.subarray(n);
        }
        if (total != null && this.received + chunk.length > total) {
          if (res.status === 206) return this.fail(new Error('Upstream trả nhiều byte hơn range đã xin'));
          this.wasted += this.received + chunk.length - total;
          chunk = chunk.subarray(0, total - this.received);
        }
        if (chunk.length) {
          this.received += chunk.length;
          this.queue.push(chunk);
        }
        if (total != null && this.received === total) {
          void reader.cancel().catch(() => {});
          break;
        }
      }
      if (total != null && this.received < total) throw new Error(`Kết nối đóng sớm: mới có ${this.received}/${total} byte`);
      this.finished = true;
      this.controller = null;
      this.queue.end();
      this.onEvent({ type: 'done', received: this.received });
      return 'done';
    } catch (e) {
      if (id !== this.attempt) return 'paused';
      if (e instanceof RangeFatalError) return this.fail(e);
      this.controller = null;
      this.onEvent({ type: 'network-error', message: (e as Error).message, received: this.received });
      return 'error';
    }
  }

  /** Huỷ request đang chạy. Byte đã nhận vẫn nằm trong hàng đợi, phía đọc không bị lỗi. */
  pause() {
    if (this.finished || !this.controller) return;
    this.attempt++;
    this.controller.abort();
    this.controller = null;
    this.onEvent({ type: 'paused', received: this.received });
  }

  /** Bỏ hẳn: phía đọc nhận lỗi. */
  abort(reason = new Error('Đã huỷ')) {
    this.pause();
    if (!this.finished && !this.failed) this.fail(reason);
  }

  private fail(err: Error): 'error' {
    this.failed = true;
    this.attempt++;
    this.controller?.abort();
    this.controller = null;
    this.queue.push(err);
    return 'error';
  }
}

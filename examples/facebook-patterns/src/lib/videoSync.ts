/**
 * Hai việc nhỏ quanh thẻ <video>:
 * 1. AppendQueue: đưa dữ liệu vào SourceBuffer tuần tự, gom chunk nhỏ thành lần append lớn, có timeout khi đọc stream.
 * 2. VideoSyncer: giữ một video chạy khớp với timeline animation bằng cách chỉnh playbackRate, seek khi lệch quá xa.
 * Ý tưởng học từ oz-player/media_source/SourceBufferManager và KeyframesVideoManager của Facebook, viết lại từ đầu.
 */

/** Phần của SourceBuffer mà AppendQueue cần (SourceBuffer thật thoả interface này). */
export interface SourceBufferLike extends EventTarget {
  readonly updating: boolean;
  appendBuffer(data: ArrayBufferView | ArrayBuffer): void;
  abort(): void;
}

export interface AppendQueueOptions {
  /** Gom chunk của stream tới ít nhất chừng này byte rồi mới append. 0 = append từng chunk. */
  appendTarget?: number;
  /** Mỗi lần read() của stream chờ tối đa chừng này ms. 0 = không giới hạn. */
  readTimeoutMs?: number;
}

export interface AppendResult {
  bytes: number;
  appends: number;
}

export class AppendQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private wakeOnDestroy = new Set<(e: Error) => void>();
  appends = 0;

  constructor(
    private readonly sb: SourceBufferLike,
    private readonly opts: AppendQueueOptions = {},
  ) {}

  /** Xếp hàng một khối dữ liệu hoặc cả một stream. Các lần gọi chạy lần lượt, không bao giờ chồng nhau. */
  append(data: Uint8Array | ReadableStream<Uint8Array>): Promise<AppendResult> {
    const run = () => (data instanceof Uint8Array ? this.appendBytes(data).then(() => ({ bytes: data.byteLength, appends: 1 })) : this.appendStream(data));
    const p = this.tail.then(run);
    this.tail = p.catch(() => {});
    return p;
  }

  /** Huỷ mọi việc đang chờ: timer, reader của stream, lời hứa đang treo. */
  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.reader?.cancel().catch(() => {});
    const err = new Error('AppendQueue đã bị huỷ');
    this.wakeOnDestroy.forEach((f) => f(err));
    this.wakeOnDestroy.clear();
    if (this.sb.updating) this.sb.abort();
  }

  /** Chờ sự kiện `type`, hoặc lỗi của SourceBuffer, hoặc destroy(). `cancel` gỡ listener khi không cần chờ nữa. */
  private once(type: string) {
    let cancel: (e: Error) => void = () => {};
    const promise = new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.sb.removeEventListener(type, ok);
        this.sb.removeEventListener('error', bad);
        this.wakeOnDestroy.delete(cancel);
      };
      const ok = () => (cleanup(), resolve());
      const bad = () => (cleanup(), reject(new Error('SourceBuffer báo lỗi khi append')));
      cancel = (e) => (cleanup(), reject(e));
      this.sb.addEventListener(type, ok);
      this.sb.addEventListener('error', bad);
      this.wakeOnDestroy.add(cancel);
    });
    return { promise, cancel };
  }

  private async appendBytes(bytes: Uint8Array) {
    if (this.destroyed) throw new Error('AppendQueue đã bị huỷ');
    while (this.sb.updating) await this.once('updateend').promise; // remove() hay abort() ở nơi khác có thể đang chạy
    const done = this.once('updateend');
    try {
      // Truyền chính view: appendBuffer tôn trọng byteOffset/byteLength. Lấy .buffer sẽ append cả ArrayBuffer gốc.
      this.sb.appendBuffer(bytes);
    } catch (e) {
      done.cancel(e as Error); // QuotaExceededError, InvalidStateError…: gỡ listener rồi báo lỗi lên
      throw e;
    }
    this.appends++;
    await done.promise;
  }

  private read(reader: ReadableStreamDefaultReader<Uint8Array>) {
    const ms = this.opts.readTimeoutMs ?? 0;
    if (!ms) return reader.read();
    return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
      this.timer = setTimeout(() => {
        this.timer = null;
        const err = new Error(`read() quá ${ms} ms`);
        void reader.cancel(err).catch(() => {}); // không để chunk đến muộn bị đọc rồi vứt
        reject(err);
      }, ms);
      reader.read().then(resolve, reject).finally(() => {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
      });
    });
  }

  private async appendStream(stream: ReadableStream<Uint8Array>): Promise<AppendResult> {
    const target = this.opts.appendTarget ?? 0;
    const reader = (this.reader = stream.getReader());
    let pending: Uint8Array[] = [];
    let pendingBytes = 0;
    let bytes = 0;
    let appends = 0;
    const flush = async () => {
      if (!pendingBytes) return;
      // Nối một lần khi đủ ngưỡng: O(tổng byte), không chép lại phần đã gom mỗi khi có chunk mới.
      const one = pending.length === 1 ? pending[0] : concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      await this.appendBytes(one);
      bytes += one.byteLength;
      appends++;
    };
    try {
      for (;;) {
        const { done, value } = await this.read(reader);
        if (done) break;
        pending.push(value);
        pendingBytes += value.byteLength;
        if (pendingBytes >= target) await flush();
      }
      await flush();
      return { bytes, appends };
    } finally {
      this.reader = null;
      reader.releaseLock();
    }
  }
}

function concat(parts: Uint8Array[], total: number) {
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o); // set() đọc đúng phần của view, kể cả khi p là subarray
    o += p.byteLength;
  }
  return out;
}

// ---------- Đồng bộ video với animation ----------

export interface VideoLike {
  currentTime: number;
  playbackRate: number;
  readonly paused: boolean;
  play(): Promise<void> | void;
  pause(): void;
}

export interface SyncOptions {
  /** Lệch dưới mức này thì coi là khớp. */
  toleranceSec?: number;
  /** Lệch quá mức này thì seek thẳng, không cố đuổi bằng tốc độ. */
  seekAboveSec?: number;
  /** Tốc độ cho phép khi đuổi (ngoài khoảng này tiếng bị méo rõ). */
  minRate?: number;
  maxRate?: number;
  /** Khoảng cách tối thiểu giữa hai lần đổi playbackRate. */
  rateIntervalMs?: number;
  /** Đuổi kịp trong tối đa chừng này giây (bản gốc: tới hết đoạn, có thể rất lâu). */
  catchUpSec?: number;
}

export type SyncAction = { type: 'rate'; rate: number; drift: number } | { type: 'seek'; to: number; drift: number } | { type: 'play' } | { type: 'pause' };

/**
 * Một layer video sống trong đoạn [from, to] của animation (tiến độ 0..1), animation dài `docDuration` giây.
 * Gọi render(progress, nowMs) mỗi frame.
 */
export class VideoSyncer {
  private lastRateAt = -Infinity;
  private readonly o: Required<SyncOptions>;

  constructor(
    private readonly video: VideoLike,
    private readonly from: number,
    private readonly to: number,
    private readonly docDuration: number,
    opts: SyncOptions = {},
  ) {
    this.o = { toleranceSec: 0.2, seekAboveSec: 1, minRate: 0.85, maxRate: 1.15, rateIntervalMs: 250, catchUpSec: 3, ...opts };
  }

  render(progress: number, nowMs: number): SyncAction | null {
    const v = this.video;
    const inside = progress >= this.from && progress <= this.to;
    if (!inside) {
      if (v.paused) return null;
      v.pause();
      v.currentTime = 0;
      v.playbackRate = 1; // lần chạy sau bắt đầu ở tốc độ chuẩn
      return { type: 'pause' };
    }
    if (v.paused) {
      void Promise.resolve(v.play()).catch(() => {}); // autoplay bị chặn thì thôi, đừng để rejection trôi nổi
      return { type: 'play' };
    }
    const target = this.docDuration * (progress - this.from);
    const segLen = this.docDuration * (this.to - this.from);
    const drift = v.currentTime - target; // > 0: video chạy trước
    const abs = Math.abs(drift);

    if (abs > this.o.seekAboveSec) {
      v.currentTime = target;
      v.playbackRate = 1;
      this.lastRateAt = nowMs;
      return { type: 'seek', to: target, drift };
    }
    if (nowMs - this.lastRateAt < this.o.rateIntervalMs) return null;
    if (abs > this.o.toleranceSec) {
      // Sau `horizon` giây animation ở target + horizon; video cần đi (target + horizon − currentTime) trong
      // cùng khoảng đó, tức rate = 1 − drift / horizon. Với horizon = phần còn lại của đoạn, đây chính là công thức của bản gốc.
      const horizon = Math.min(segLen - target, this.o.catchUpSec);
      const raw = horizon > 0.05 ? 1 - drift / horizon : 1;
      const rate = Math.min(this.o.maxRate, Math.max(this.o.minRate, raw));
      if (Math.abs(rate - v.playbackRate) < 0.005) return null;
      v.playbackRate = rate;
      this.lastRateAt = nowMs;
      return { type: 'rate', rate, drift };
    }
    if (v.playbackRate !== 1 && abs < this.o.toleranceSec / 4) {
      v.playbackRate = 1; // đã khớp: trả về tốc độ chuẩn, có khoảng trễ (hysteresis) để không bật tắt liên tục
      this.lastRateAt = nowMs;
      return { type: 'rate', rate: 1, drift };
    }
    return null;
  }
}

/**
 * Trình phát khung hình kiểu RLottie của Telegram Web: khung được render ở nơi khác (worker),
 * main thread chỉ lo hẹn giờ, cache khung và vẽ lên canvas.
 *
 * - Độ phân giải canvas = size × max(DPR × quality, 1): giảm chất lượng chỉ trên màn DPR cao.
 * - Giảm fps cho sticker ưu tiên thấp: chỉ render 1/reduceFactor khung (60 → 30).
 * - Chỉ số khung là số thực, cộng theo thời gian thật giữa hai lần vẽ.
 * - Luôn xin trước khung kế tiếp; cứ `cacheModulo` khung thì bỏ khung đứng trước để giới hạn bộ nhớ.
 */

export type FrameSource = (frameIndex: number, size: number) => Promise<ImageData>;

export interface FramePlayerOptions {
  /** kích thước CSS (px) */
  size: number;
  /** số khung gốc và fps gốc của animation */
  framesCount: number;
  sourceFps: number;
  isLowPriority?: boolean;
  /** mặc định 1 (0.75 cho ưu tiên thấp như Telegram) */
  quality?: number;
  dpr?: number;
  loop?: boolean;
  /**
   * 'capped': như bản gốc, mỗi lần vẽ tiến tối đa 1 khung → máy/màn hình chậm thì animation chậm theo.
   * 'realtime': được nhảy nhiều khung để giữ đúng thời lượng (mặc định).
   */
  timing?: 'capped' | 'realtime';
  /** cứ N khung thì xoá khung đứng trước; 0 = giữ hết. Mặc định 4 (Telegram: Safari 2, nơi khác 4) */
  cacheModulo?: number;
  /** gọi mỗi khi hết một vòng, kèm thời gian thực của vòng đó (ms) */
  onLoop?: (durationMs: number) => void;
  now?: () => number;
  requestFrame?: (cb: () => void) => number;
  cancelFrame?: (id: number) => void;
}

const HIGH_PRIORITY_MAX_FPS = 60;
const LOW_PRIORITY_MAX_FPS = 30;

export class FramePlayer {
  readonly imgSize: number;
  readonly reduceFactor: number;
  readonly msPerFrame: number;
  /** số khung thật sự cần render sau khi giảm fps */
  readonly framesCount: number;

  private frames = new Map<number, ImageData>();
  private pending = new Set<number>();
  private ctx: CanvasRenderingContext2D;
  private approxFrameIndex = 0;
  private prevFrameIndex = -1;
  private lastRenderAt?: number;
  private rafId?: number;
  private waiting = false;
  private playing = false;
  private destroyed = false;
  private speed = 1;
  private direction: 1 | -1 = 1;
  private loopStartedAt?: number;

  /** số liệu cho demo */
  stats = { requested: 0, drawn: 0, skipped: 0, waits: 0 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private source: FrameSource,
    private options: FramePlayerOptions,
  ) {
    const { size, isLowPriority, dpr = window.devicePixelRatio || 1 } = options;
    const quality = options.quality ?? (isLowPriority ? 0.75 : 1);
    // Chất lượng giảm chỉ chấp nhận được trên màn DPR cao: DPR 1 thì vẫn giữ đủ size
    this.imgSize = Math.round(size * Math.max(dpr * quality, 1));
    canvas.width = this.imgSize;
    canvas.height = this.imgSize;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    this.ctx = canvas.getContext('2d')!;

    const maxFps = isLowPriority ? LOW_PRIORITY_MAX_FPS : HIGH_PRIORITY_MAX_FPS;
    // chỉ giảm khi chia hết (60 → 30 được, 50 → 30 thì giữ nguyên 50)
    this.reduceFactor = options.sourceFps % maxFps === 0 ? options.sourceFps / maxFps : 1;
    this.msPerFrame = 1000 / (options.sourceFps / this.reduceFactor);
    this.framesCount = Math.ceil(options.framesCount / this.reduceFactor);
  }

  get cacheSize() {
    return this.frames.size;
  }

  get bytesPerFrame() {
    return this.imgSize * this.imgSize * 4;
  }

  get isPlaying() {
    return this.playing;
  }

  /** chỉ số khung hiện tại theo animation gốc (trước khi giảm fps) */
  get currentSourceFrame() {
    return Math.round(this.approxFrameIndex) * this.reduceFactor;
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  setTiming(timing: 'capped' | 'realtime') {
    this.options.timing = timing;
  }

  play(direction: 1 | -1 = 1) {
    this.direction = direction;
    if (this.playing) return;
    this.playing = true;
    this.lastRenderAt = undefined;
    this.loopStartedAt = undefined;
    this.schedule();
  }

  /** dừng và chỉ giữ khung đang hiện (bản gốc cũng giải phóng các khung khác khi pause) */
  pause() {
    this.playing = false;
    this.waiting = false;
    if (this.rafId !== undefined) this.cancel(this.rafId);
    this.rafId = undefined;
    const current = Math.round(this.approxFrameIndex);
    for (const index of [...this.frames.keys()]) if (index !== current) this.frames.delete(index);
  }

  destroy() {
    this.destroyed = true;
    this.pause();
    this.frames.clear();
  }

  private now() {
    return this.options.now?.() ?? performance.now();
  }

  private schedule() {
    const request = this.options.requestFrame ?? ((cb: () => void) => requestAnimationFrame(cb));
    this.rafId = request(() => this.tick());
  }

  private cancel(id: number) {
    (this.options.cancelFrame ?? cancelAnimationFrame)(id);
  }

  private tick() {
    this.rafId = undefined;
    if (!this.playing || this.destroyed) return;

    const frameIndex = Math.round(this.approxFrameIndex);
    const frame = this.frames.get(frameIndex);
    if (!frame) {
      // khung chưa về: dừng vòng lặp, onFrameLoad sẽ gọi lại
      this.request(frameIndex);
      this.waiting = true;
      this.stats.waits++;
      return;
    }

    const { cacheModulo = 4 } = this.options;
    if (cacheModulo && frameIndex % cacheModulo === 0 && this.framesCount >= 3) {
      this.frames.delete(this.wrap(frameIndex - 1));
    }
    this.request(this.wrap(frameIndex + this.direction));

    if (frameIndex !== this.prevFrameIndex) {
      this.ctx.putImageData(frame, 0, 0);
      this.stats.drawn++;
      this.prevFrameIndex = frameIndex;
    }

    const now = this.now();
    // lần vẽ đầu chưa có mốc thời gian: coi như đúng 1 khung
    const elapsedFrames = this.lastRenderAt === undefined ? 1 : (now - this.lastRenderAt) / this.msPerFrame;
    this.lastRenderAt = now;
    let delta = this.direction * this.speed * elapsedFrames;
    if (this.options.timing === 'capped') {
      // bản gốc chỉ chặn chiều tiến: Math.min(1, delta). Chạy lùi thì không chặn (lệch hai chiều)
      delta = Math.min(1, delta);
    }
    if (Math.abs(delta) > 1) this.stats.skipped += Math.floor(Math.abs(delta)) - 1;

    let next = this.approxFrameIndex + delta;
    // so theo chỉ số SAU KHI làm tròn: 119.6 vẫn còn là khung 120 → đã hết vòng
    const rounded = Math.round(next);
    if (rounded > this.framesCount - 1 || rounded < 0) {
      if (this.options.loop === false) {
        this.playing = false;
        return;
      }
      // giữ phần lẻ để vòng sau vẫn đúng nhịp (bản gốc đặt thẳng về 0). Chia theo số vòng đã qua:
      // tab bị ẩn lâu rồi quay lại thì delta có thể dài nhiều vòng
      next -= Math.floor(rounded / this.framesCount) * this.framesCount;
      if (this.loopStartedAt !== undefined) this.options.onLoop?.(now - this.loopStartedAt);
      this.loopStartedAt = now;
    }
    this.approxFrameIndex = next;

    const nextIndex = this.wrap(Math.round(next));
    if (!this.frames.has(nextIndex)) {
      this.request(nextIndex);
      this.waiting = true;
      this.stats.waits++;
      return;
    }
    this.schedule();
  }

  private wrap(index: number) {
    return ((index % this.framesCount) + this.framesCount) % this.framesCount;
  }

  private request(frameIndex: number) {
    if (this.frames.has(frameIndex) || this.pending.has(frameIndex)) return;
    this.pending.add(frameIndex);
    this.stats.requested++;
    this.source(frameIndex * this.reduceFactor, this.imgSize).then(
      (image) => this.onFrameLoad(frameIndex, image),
      () => this.pending.delete(frameIndex),
    );
  }

  private onFrameLoad(frameIndex: number, image: ImageData) {
    this.pending.delete(frameIndex);
    if (this.destroyed) return;
    this.frames.set(frameIndex, image);
    if (this.waiting && this.playing) {
      this.waiting = false;
      // thời gian chờ khung không tính vào animation (giống video đang buffer). Nếu tính, lần vẽ sau
      // sẽ nhảy xa tới khung chưa có, lại phải chờ, và cứ đuổi theo mãi
      this.lastRenderAt = undefined;
      this.schedule();
    }
  }
}

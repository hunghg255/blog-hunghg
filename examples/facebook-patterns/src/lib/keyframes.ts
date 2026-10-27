/**
 * Engine animation bằng JS kiểu Keyframes của Facebook:
 * - Một vòng requestAnimationFrame DÙNG CHUNG cho mọi animation (KeyframesLoop).
 * - Kẹp delta tối đa 1000ms, và khi tab được focus lại thì coi như vừa qua đúng một frame,
 *   để animation không "nhảy cóc" sau khi tab nằm nền.
 * - Easing cubic-bezier giải bằng Newton-Raphson + phân đôi (CubicBezier).
 *
 * Khác bản gốc:
 * - Một callback ném lỗi không làm chết cả vòng lặp (bản gốc gọi rAF tiếp SAU forEach, lỗi
 *   giữa chừng làm mọi animation đứng hình).
 * - Không thể có hai vòng rAF song song khi animation tự cancel rồi start trong callback.
 * - Sai số mặc định 1e-4 thay vì 0.005 (với đường cong dốc, 0.005 theo trục x có thể lệch
 *   tới 0.15 theo trục y).
 */

// ---- Cubic bezier ----

export class CubicBezier {
  private ax: number;
  private bx: number;
  private cx: number;
  private ay: number;
  private by: number;
  private cy: number;

  constructor(p1: [number, number], p2: [number, number]) {
    // Khai triển đa thức Bézier B(t) = ((a t + b) t + c) t cho từng trục, tính MỘT lần.
    this.cx = 3 * p1[0];
    this.bx = 3 * (p2[0] - p1[0]) - this.cx;
    this.ax = 1 - this.cx - this.bx;
    this.cy = 3 * p1[1];
    this.by = 3 * (p2[1] - p1[1]) - this.cy;
    this.ay = 1 - this.cy - this.by;
  }

  private sampleX(t: number) {
    return ((this.ax * t + this.bx) * t + this.cx) * t;
  }

  private sampleY(t: number) {
    return ((this.ay * t + this.by) * t + this.cy) * t;
  }

  private slopeX(t: number) {
    return (3 * this.ax * t + 2 * this.bx) * t + this.cx;
  }

  /** Tìm tham số t sao cho x(t) = x. */
  solveCurveX(x: number, epsilon = 1e-4) {
    // 1) Newton-Raphson: hội tụ rất nhanh khi đạo hàm không quá nhỏ
    let t = x;
    for (let i = 0; i < 8; i++) {
      const error = this.sampleX(t) - x;
      if (Math.abs(error) < epsilon) return t;
      const slope = this.slopeX(t);
      if (Math.abs(slope) < 1e-6) break; // gần chỗ đường cong "dựng đứng": Newton sẽ văng xa
      t -= error / slope;
    }
    // 2) Phân đôi trên [0, 1]: chậm hơn nhưng chắc chắn hội tụ (x(t) đơn điệu khi x1, x2 ∈ [0, 1])
    let lo = 0;
    let hi = 1;
    t = x;
    if (t <= lo) return lo;
    if (t >= hi) return hi;
    for (let i = 0; i < 60 && lo < hi; i++) {
      const value = this.sampleX(t);
      if (Math.abs(value - x) < epsilon) return t;
      if (x > value) lo = t;
      else hi = t;
      t = (hi - lo) / 2 + lo;
    }
    return t;
  }

  /** Tiến độ thời gian x ∈ [0, 1] -> tiến độ animation y. */
  solve(x: number, epsilon?: number) {
    return this.sampleY(this.solveCurveX(x, epsilon));
  }
}

export const cubicBezier = (x1: number, y1: number, x2: number, y2: number) => {
  const curve = new CubicBezier([x1, y1], [x2, y2]);
  return (x: number) => curve.solve(x);
};

// ---- Vòng rAF dùng chung ----

const MAX_DELTA = 1000;
const ONE_FRAME = 1000 / 60;

export interface LoopHandle {
  /** chạy tối đa `frames` frame rồi tự dừng (mặc định chạy mãi) */
  start(frames?: number): void;
  cancel(): void;
  isRunning(): boolean;
}

interface Entry {
  callback: (deltaMs: number) => void;
  previousTime: number;
  framesRemaining: number;
}

const running = new Set<Entry>();
let rafId: number | null = null;
let focusListenerInstalled = false;

/** số lần callback rAF thật sự được gọi, để demo đếm */
export const loopStats = { rafCallbacks: 0, errors: 0 };

/** Nơi nhận lỗi của animation; production có thể nối vào error logger. */
export const loopConfig = {
  onError: (error: unknown) => console.error(error),
};

function tick() {
  rafId = null;
  loopStats.rafCallbacks++;
  const now = performance.now();
  // chụp danh sách: animation cancel/start trong lúc lặp không làm hỏng vòng lặp này
  for (const entry of [...running]) {
    if (!running.has(entry)) continue;
    const delta = Math.min(now - (entry.previousTime || now), MAX_DELTA);
    entry.previousTime = now;
    try {
      entry.callback(delta);
    } catch (error) {
      // cô lập lỗi: báo ra ngoài nhưng các animation khác vẫn chạy tiếp
      loopStats.errors++;
      running.delete(entry);
      loopConfig.onError(error);
      continue;
    }
    entry.framesRemaining -= 1;
    if (entry.framesRemaining <= 0) running.delete(entry);
  }
  schedule();
}

function schedule() {
  if (running.size > 0 && rafId == null) rafId = requestAnimationFrame(tick);
}

function installFocusListener() {
  if (focusListenerInstalled || typeof window === 'undefined') return;
  focusListenerInstalled = true;
  // Tab vừa quay lại: coi như frame trước cách đây đúng 1 frame, tránh delta khổng lồ
  window.addEventListener('focus', () => {
    const now = performance.now();
    running.forEach((entry) => (entry.previousTime = now - ONE_FRAME));
  });
}

export function createLoop(callback: (deltaMs: number) => void): LoopHandle {
  const entry: Entry = { callback, previousTime: 0, framesRemaining: Infinity };
  installFocusListener();
  return {
    start(frames = Infinity) {
      entry.framesRemaining = frames;
      if (running.has(entry)) return;
      entry.previousTime = performance.now();
      running.add(entry);
      schedule();
    },
    cancel() {
      running.delete(entry);
    },
    isRunning: () => running.has(entry),
  };
}

/** Chỉ để demo/test: giả lập tab vừa nằm nền `ms` mili giây (frame kế tiếp có delta lớn). */
export function simulateBackground(ms: number) {
  running.forEach((entry) => (entry.previousTime -= ms));
}

/** Tiện ích: tween một giá trị 0 -> 1 trong `duration` ms với easing cho trước. */
export function tween(
  duration: number,
  easing: (x: number) => number,
  onUpdate: (value: number) => void,
  onDone?: () => void,
): LoopHandle {
  let elapsed = 0;
  const handle = createLoop((delta) => {
    elapsed = Math.min(elapsed + delta, duration);
    onUpdate(easing(elapsed / duration));
    if (elapsed >= duration) {
      handle.cancel();
      onDone?.();
    }
  });
  handle.start();
  return handle;
}

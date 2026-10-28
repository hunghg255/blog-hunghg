/**
 * Đo FPS để phát hiện UI đóng băng + theo dõi người dùng rảnh — viết lại từ ý tưởng của
 * WhatsApp Web 2020 (module ihgefacbb, idle monitor trong chgfegiddc). Không phải mã gốc.
 */

type Callback = (fps: number, at: number) => void;

/** Vị trí chèn để mảng ngưỡng luôn tăng dần (binary search). */
export function insertionIndex(sorted: number[], value: number) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface FpsMonitorOptions {
  /** độ dài cửa sổ tính trung bình (bản gốc 500 ms) */
  windowMs?: number;
  /** một khung dài hơn mốc này thì báo "đứng hình" ngay, không chờ trung bình */
  longFrameMs?: number;
  now?: () => number;
  raf?: (cb: FrameRequestCallback) => number;
  caf?: (id: number) => void;
  /** chỉ đo khi tab có focus, giống bản gốc */
  pauseOnBlur?: boolean;
}

export function createFpsMonitor({
  windowMs = 500,
  longFrameMs = 1000,
  now = () => performance.now(),
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
  pauseOnBlur = true,
}: FpsMonitorOptions = {}) {
  const thresholds: number[] = [];
  const callbacks: Callback[] = [];
  const freezeListeners = new Set<(gapMs: number, at: number) => void>();
  let current = 60;
  let frameId: number | undefined;
  let prevFrame = 0;
  let windowStart = 0;
  let samples = 0;
  let total = 0;

  const tick = () => {
    const t = now();
    const gap = t - prevFrame;
    samples += 1;
    total += gap;
    if (gap >= longFrameMs) freezeListeners.forEach((cb) => cb(gap, t));
    if (t - windowStart >= windowMs) update(t);
    prevFrame = t;
    frameId = raf(tick);
  };

  const update = (t: number) => {
    const fps = Math.min(1000 / (total / samples), 60);
    samples = 0;
    total = 0;
    windowStart = t;
    // chỉ báo khi FPS đổi đáng kể, để không gọi lại liên tục quanh một ngưỡng
    if (Math.abs(fps - current) <= 1) return;
    current = fps;
    for (let i = thresholds.length - 1; i >= 0 && thresholds[i] > fps; i--) callbacks[i](fps, t);
  };

  const start = () => {
    if (frameId !== undefined) return;
    prevFrame = windowStart = now();
    frameId = raf(tick);
  };
  const stop = () => {
    if (frameId === undefined) return;
    caf(frameId);
    frameId = undefined;
  };

  const listening = () => thresholds.length + freezeListeners.size > 0;
  const sync = () => {
    if (listening()) {
      if (pauseOnBlur && typeof window !== 'undefined') {
        window.addEventListener('focus', start);
        window.addEventListener('blur', stop);
      }
      start();
    } else {
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', start);
        window.removeEventListener('blur', stop);
      }
      stop();
    }
  };

  return {
    /** gọi cb khi FPS trung bình rơi xuống dưới `fps` */
    whenLessThan(fps: number, cb: Callback) {
      if (fps < 0 || fps > 60) throw new RangeError('fps must be between 0 and 60');
      const i = insertionIndex(thresholds, fps);
      thresholds.splice(i, 0, fps);
      callbacks.splice(i, 0, cb);
      sync();
      return () => {
        const j = callbacks.indexOf(cb);
        if (j !== -1) (thresholds.splice(j, 1), callbacks.splice(j, 1));
        sync();
      };
    },
    /** gọi cb với mỗi khung dài hơn longFrameMs — không phụ thuộc pha của cửa sổ trung bình */
    onLongFrame(cb: (gapMs: number, at: number) => void) {
      freezeListeners.add(cb);
      sync();
      return () => (freezeListeners.delete(cb), sync());
    },
    get fps() {
      return current;
    },
  };
}

/**
 * Mô phỏng thuần (không cần trình duyệt): cho dãy thời điểm vẽ khung, trả về các FPS trung bình
 * mà cách "cửa sổ 500 ms" sẽ báo. Dùng để thấy một lần đứng hình có bị báo hay không tuỳ pha.
 */
export function windowedFps(frameTimes: number[], windowMs = 500) {
  const reports: { at: number; fps: number }[] = [];
  let windowStart = frameTimes[0];
  let samples = 0;
  let total = 0;
  for (let i = 1; i < frameTimes.length; i++) {
    samples += 1;
    total += frameTimes[i] - frameTimes[i - 1];
    if (frameTimes[i] - windowStart >= windowMs) {
      reports.push({ at: frameTimes[i], fps: Math.min(1000 / (total / samples), 60) });
      samples = 0;
      total = 0;
      windowStart = frameTimes[i];
    }
  }
  return reports;
}

/** Dãy khung 60 fps có một lần đứng hình dài freezeMs bắt đầu tại freezeAt. */
export function framesWithFreeze(durationMs: number, freezeAt: number, freezeMs: number, frame = 1000 / 60) {
  const out: number[] = [];
  let t = 0;
  let frozen = false;
  while (t <= durationMs) {
    out.push(t);
    if (!frozen && t >= freezeAt) {
      t += freezeMs;
      frozen = true;
    } else t += frame;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idle monitor

export type IdleMode = 'periodic' | 'since-last-activity';

/**
 * Mô phỏng thời điểm bị coi là "rảnh".
 * - `periodic` (bản gốc): đợi idleMs kể từ lần QUAY LẠI gần nhất, rồi mới bắt đầu nghe hoạt động;
 *   hoạt động trong lúc đợi không được tính.
 * - `since-last-activity`: đếm idleMs từ hoạt động cuối cùng.
 * Trả về các khoảng [từ, đến) mà người dùng bị đánh dấu unavailable.
 */
export function simulateIdle(activity: number[], endAt: number, idleMs: number, graceMs: number, mode: IdleMode) {
  const sorted = [...activity].sort((a, b) => a - b);
  const spans: [number, number][] = [];
  if (mode === 'periodic') {
    let armedAt = idleMs;
    while (armedAt < endAt) {
      const next = sorted.find((a) => a >= armedAt);
      const awayAt = armedAt + graceMs;
      if (next === undefined) {
        if (awayAt < endAt) spans.push([awayAt, endAt]);
        break;
      }
      if (next > awayAt) spans.push([awayAt, next]);
      armedAt = next + idleMs;
    }
    return spans;
  }
  let last = 0;
  for (const a of [...sorted, endAt]) {
    const awayAt = last + idleMs;
    if (a > awayAt) spans.push([awayAt, a === endAt ? endAt : a]);
    last = a;
  }
  return spans.filter(([from, to]) => to > from);
}

/** Idle monitor thật trên trình duyệt: tính từ hoạt động cuối cùng. */
export function createIdleMonitor(idleMs: number, onChange: (idle: boolean) => void) {
  const events: [EventTarget, string][] = [
    [document, 'pointermove'],
    [document, 'keydown'],
    [document, 'scroll'],
    [window, 'focus'],
  ];
  let idle = false;
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ((idle = true), onChange(true)), idleMs);
  };
  const activity = () => {
    if (idle) ((idle = false), onChange(false));
    arm();
  };
  events.forEach(([t, e]) => t.addEventListener(e, activity, { passive: true }));
  arm();
  return () => {
    clearTimeout(timer);
    events.forEach(([t, e]) => t.removeEventListener(e, activity));
  };
}

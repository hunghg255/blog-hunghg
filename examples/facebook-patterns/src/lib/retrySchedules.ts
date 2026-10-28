/**
 * Ba kiểu lịch retry trong code Facebook:
 * 1. VideoUploadRetries: backoff luỹ thừa có trần + jitter, dừng theo số lần hoặc tổng thời gian.
 * 2. Player live (OzMpdUpdater + handleOzStreamErrorEvent): phân loại lỗi theo HTTP code,
 *    chờ theo dãy Fibonacci, phát hiện stream đứng khi manifest không nhích.
 * 3. SyntaxErrorMonitor: báo lỗi CDN tối đa một lần mỗi N ngày, nhớ bằng số ngày trong cookie.
 * Khác bản gốc: có full jitter, lịch retry của manifest thật sự dùng delay được trả về,
 * mã 410 kết thúc stream, đồng hồ lùi không làm kẹt bộ đếm ngày.
 */

// ───────────────────────── 1. Backoff có trần ─────────────────────────

export type JitterMode = 'fixed' | 'full' | 'equal';

export interface BackoffPolicy {
  /** delay = min(initial + expBase · multiplier^(n−1), max) rồi cộng jitter */
  initial: number;
  expBase: number;
  multiplier: number;
  max: number;
  /** 'fixed': ± jitter/2 ms như bản gốc; 'full': ngẫu nhiên trong [0, delay]; 'equal': [delay/2, delay] */
  jitterMode: JitterMode;
  jitter: number;
  limits: { delayRetries?: number; totalRetries?: number; totalTimeMs?: number };
}

/** Giá trị mặc định của VideoUploadRetries */
export const UPLOAD_POLICY: BackoffPolicy = {
  initial: 400,
  expBase: 100,
  multiplier: 1.5,
  max: 8000,
  jitterMode: 'fixed',
  jitter: 100,
  limits: { totalRetries: 500, totalTimeMs: 60 * 60 * 1000 },
};

export function backoffDelay(policy: BackoffPolicy, attempt: number, random = Math.random) {
  const base = Math.min(policy.initial + policy.expBase * policy.multiplier ** (attempt - 1), policy.max);
  const r = random();
  switch (policy.jitterMode) {
    case 'full':
      return Math.round(base * r);
    case 'equal':
      return Math.round(base / 2 + (base / 2) * r);
    default:
      return Math.max(0, Math.round(base + (r - 0.5) * policy.jitter));
  }
}

export type AbandonReason = 'predicate' | 'delay-retries' | 'total-retries' | 'total-time';
export type RetryDecision =
  | { action: 'retry'; delayMs: number; delayRetry: number; totalRetry: number }
  | { action: 'abandon'; reason: AbandonReason; delayRetry: number; totalRetry: number };

export function createRetryState(policy: BackoffPolicy = UPLOAD_POLICY, now = Date.now, random = Math.random) {
  const startedAt = now();
  let delayRetry = 0; // reset khi có tiến triển (vd upload thêm được một chunk)
  let totalRetry = 0; // không bao giờ reset
  return {
    next(shouldRetry?: () => boolean): RetryDecision {
      const { limits } = policy;
      let reason: AbandonReason | null = null;
      if (shouldRetry && !shouldRetry()) reason = 'predicate';
      else if (limits.delayRetries != null && delayRetry >= limits.delayRetries) reason = 'delay-retries';
      else if (limits.totalRetries != null && totalRetry >= limits.totalRetries) reason = 'total-retries';
      else if (limits.totalTimeMs != null && now() - startedAt >= limits.totalTimeMs) reason = 'total-time';
      if (reason) return { action: 'abandon', reason, delayRetry, totalRetry };
      delayRetry++;
      totalRetry++;
      return { action: 'retry', delayMs: backoffDelay(policy, delayRetry, random), delayRetry, totalRetry };
    },
    /** gọi khi request thành công: lần lỗi sau bắt đầu lại từ delay nhỏ nhất */
    resetDelay() {
      delayRetry = 0;
    },
  };
}

// ───────────────────────── 2. Lỗi manifest live ─────────────────────────

/** giây, theo số lần thử lại liên tiếp (bản gốc: [0,1,1,2,3,5,8,13,21,34]) */
export const FIB_BACKOFF_SEC = [0, 1, 1, 2, 3, 5, 8, 13, 21, 34];

export interface StreamErrorConfig {
  /** mã nghĩa là buổi live đã kết thúc */
  endCodes: string[];
  /** mã bỏ qua: thử lại ngay */
  skipCodes: string[];
  /** mã thử lại theo bảng Fibonacci */
  fibCodes: string[];
  /** mã thử lại sau một khoảng cố định (ms) */
  retryIntervals: Record<string, number>;
}

export const DEFAULT_STREAM_CONFIG: StreamErrorConfig = {
  endCodes: ['410'],
  skipCodes: [],
  fibCodes: ['504'],
  retryIntervals: { '0': 1000, '404': 2000, '502': 1000, '503': 1000, '504': 1000 },
};

export type StreamErrorAction =
  | { action: 'end' }
  | { action: 'retry'; delayMs: number }
  | { action: 'give-up' };

/** attempt: số lần đã thử lại liên tiếp trước lần này (0 = lỗi đầu tiên) */
export function classifyStreamError(code: string | null, attempt: number, cfg: StreamErrorConfig = DEFAULT_STREAM_CONFIG): StreamErrorAction {
  if (code != null && cfg.endCodes.includes(code)) return { action: 'end' };
  if (code != null && cfg.skipCodes.includes(code)) return { action: 'retry', delayMs: 0 };
  const fib = FIB_BACKOFF_SEC[attempt];
  if (fib == null) return { action: 'give-up' }; // hết bảng: 10 lần thử
  if (code != null && cfg.fibCodes.includes(code)) return { action: 'retry', delayMs: fib * 1000 };
  const fixed = code != null ? cfg.retryIntervals[code] : undefined;
  return fixed != null ? { action: 'retry', delayMs: fixed } : { action: 'give-up' };
}

export type PollEvent =
  | { type: 'ok'; at: number; endTime: number }
  | { type: 'error'; at: number; code: string; next: StreamErrorAction }
  | { type: 'interrupted'; at: number; endTime: number }
  | { type: 'resumed'; at: number; endTime: number }
  | { type: 'ended'; at: number }
  | { type: 'failed'; at: number };

export interface ManifestPollerOptions {
  /** tải manifest; trả endTime của đoạn cuối, hoặc ném { code } */
  fetch: () => Promise<number>;
  /** minimumUpdatePeriod của MPD, ms */
  periodMs: number;
  /** số lần cập nhật liên tiếp endTime không đổi thì coi là stream đứng (0 = tắt) */
  staleThreshold?: number;
  config?: StreamErrorConfig;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  onEvent?: (e: PollEvent) => void;
}

export function createManifestPoller(opts: ManifestPollerOptions) {
  const {
    fetch,
    periodMs,
    staleThreshold = 3,
    config = DEFAULT_STREAM_CONFIG,
    now = Date.now,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    onEvent,
  } = opts;
  let timer: unknown = null;
  let stopped = false;
  let attempt = 0;
  const stale = createStaleDetector(staleThreshold);

  const schedule = (ms: number) => {
    if (stopped) return;
    timer = setTimer(poll, ms);
  };

  async function poll() {
    timer = null;
    try {
      const endTime = await fetch();
      if (stopped) return;
      attempt = 0;
      onEvent?.({ type: 'ok', at: now(), endTime });
      const change = stale.update(endTime);
      if (change) onEvent?.({ type: change, at: now(), endTime });
      schedule(periodMs);
    } catch (err) {
      if (stopped) return;
      const code = String((err as { code?: unknown })?.code ?? '0');
      const next = classifyStreamError(code, attempt++, config);
      onEvent?.({ type: 'error', at: now(), code, next });
      if (next.action === 'retry') schedule(next.delayMs); // bản gốc bỏ qua delay này
      else if (next.action === 'end') {
        stopped = true;
        onEvent?.({ type: 'ended', at: now() });
      } else {
        stopped = true;
        onEvent?.({ type: 'failed', at: now() });
      }
    }
  }

  return {
    start() {
      stopped = false;
      schedule(0);
    },
    stop() {
      stopped = true;
      if (timer != null) clearTimer(timer);
      timer = null;
    },
  };
}

/** endTime của đoạn cuối không nhích qua `threshold` lần cập nhật liên tiếp → 'interrupted'; nhích lại → 'resumed'. */
export function createStaleDetector(threshold: number) {
  let last: number | null = null;
  let same = 0;
  let interrupted = false;
  return {
    update(endTime: number | null): 'interrupted' | 'resumed' | null {
      let out: 'interrupted' | 'resumed' | null = null;
      if (endTime != null && endTime === last) same++;
      else {
        same = 0;
        if (interrupted && last != null) {
          interrupted = false;
          out = 'resumed';
        }
      }
      if (!interrupted && threshold > 0 && same >= threshold && endTime != null) {
        interrupted = true;
        out = 'interrupted';
      }
      last = endTime;
      return out;
    },
  };
}

// ───────────────────────── 3. Báo lỗi CDN mỗi N ngày ─────────────────────────

/** mốc riêng của SyntaxErrorMonitor: 2010-01-01 UTC */
export const DAY_EPOCH = Date.UTC(2010, 0, 1);

export function dayNumber(nowMs: number, epoch = DAY_EPOCH) {
  return Math.floor((nowMs - epoch) / 86_400_000);
}

/**
 * Có nên gửi báo cáo không, và giá trị mới để lưu (vào cookie).
 * Bản gốc: gửi khi chưa có giá trị hoặc đã qua đủ freqDays. Thêm: giá trị lưu nằm ở "tương lai"
 * (đồng hồ máy từng chạy nhanh rồi được chỉnh lại) thì coi như chưa có, để không bị kẹt nhiều ngày.
 */
export function shouldReport(stored: string | null, nowMs: number, freqDays: number): { report: boolean; store: number; lastDay: number | null } {
  const today = dayNumber(nowMs);
  const last = stored != null && /^\d+$/.test(stored) ? Number(stored) : null;
  if (last == null || last > today || today - last >= freqDays) return { report: true, store: today, lastDay: last };
  return { report: false, store: last, lastDay: last };
}

/** Chỉ đếm SyntaxError đến từ script của chính mình (lỗi của extension hay script bên thứ ba thì bỏ). */
export function isOwnSyntaxError(e: { message?: string; filename?: string; error?: unknown }, ownOrigins: string[]) {
  const name = (e.error as { name?: string } | undefined)?.name;
  const looksSyntax = name === 'SyntaxError' || /syntaxerror/i.test(e.message ?? '');
  if (!looksSyntax) return false;
  if (!e.filename) return false;
  try {
    return ownOrigins.includes(new URL(e.filename).origin);
  } catch {
    return false;
  }
}

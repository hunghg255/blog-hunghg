/**
 * Bắt lỗi theo "ngữ cảnh" (ý tưởng từ ErrorGuard / ErrorPubSub / ErrorNormalizeUtils của Facebook).
 *
 * - `guard(fn, { name })` bọc callback: lỗi bị bắt, chuẩn hoá và gửi tới các listener,
 *   code gọi callback vẫn chạy tiếp.
 * - Guard lồng nhau tạo thành "guard stack", nên khi lỗi ta biết nó xảy ra ở đâu:
 *   ["Feed.onEvent", "LikeButton.onClick"] thay vì chỉ một stack trace đã minify.
 * - Lỗi lọt ra ngoài (window.onerror, unhandledrejection) cũng đi qua cùng một pipeline.
 */

export type ErrorSource = 'GUARDED' | 'GLOBAL' | 'UNHANDLED_REJECTION' | 'REACT';

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
  source: ErrorSource;
  /** guard stack lúc lỗi xảy ra, ngoài cùng trước */
  guardList: string[];
  /** lỗi gốc có phải Error không (throw "abc" hay throw {} cũng gặp ngoài đời) */
  wasErrorObject: boolean;
  /** giá trị bị throw ban đầu, giữ nguyên để gửi cho Sentry (còn `cause`, field riêng…) */
  original: unknown;
  timestamp: number;
}

type ErrorListener = (error: NormalizedError) => void;

const guardStack: string[] = [];
const listeners = new Set<ErrorListener>();

// Lịch sử lỗi gần nhất để phát lại cho listener đăng ký muộn (vd: Sentry khởi tạo sau khi
// app đã chạy được một lúc). Đầy thì bỏ phần giữa: giữ lỗi đầu phiên (thường là nguyên nhân
// gốc) và lỗi mới nhất — giống ErrorPubSub của Facebook.
const MAX_HISTORY = 50;
const history: NormalizedError[] = [];

export const errorGuardConfig = {
  /**
   * true = không bắt lỗi, để lỗi văng ra cho DevTools dừng đúng chỗ (FB gọi là `nocatch`).
   * Hữu ích khi debug local.
   */
  noCatch: false,
};

/**
 * Kiểm tra "giống Error" bằng duck typing thay vì instanceof: Error tạo trong iframe khác
 * (realm khác) có prototype khác, `instanceof Error` sẽ trả về false.
 */
function isErrorLike(value: unknown): value is Error {
  return (
    value instanceof Error ||
    (typeof value === 'object' &&
      value !== null &&
      typeof (value as Error).message === 'string' &&
      typeof (value as Error).name === 'string')
  );
}

/** Biến mọi thứ bị `throw` thành Error để luôn có name/message/stack. */
export function toError(thrown: unknown): Error {
  if (isErrorLike(thrown)) return thrown;
  let message: string;
  try {
    message = typeof thrown === 'string' ? thrown : JSON.stringify(thrown);
  } catch {
    message = String(thrown);
  }
  const error = new Error(`Non-error thrown: ${message}`);
  error.name = 'NonError';
  return error;
}

export function normalizeError(
  thrown: unknown,
  source: ErrorSource,
  guardList: string[] = [],
): NormalizedError {
  const error = toError(thrown);
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    source,
    guardList,
    wasErrorObject: isErrorLike(thrown),
    original: thrown,
    timestamp: Date.now(),
  };
}

function callListener(listener: ErrorListener, error: NormalizedError) {
  try {
    listener(error);
  } catch (listenerError) {
    // Không báo lại qua pipeline (sẽ lặp vô hạn), nhưng cũng đừng nuốt im lặng:
    // tích hợp Sentry hỏng mà không ai biết còn tệ hơn.
    console.error('[errorGuard] listener lỗi:', listenerError);
  }
}

let reporting = false;

/**
 * Đưa một lỗi đã chuẩn hoá vào pipeline. Đặt tên khác `window.reportError` (API chuẩn của
 * trình duyệt) để không nhầm lẫn / auto-import nhầm.
 */
export function reportNormalizedError(error: NormalizedError) {
  // Chống vòng lặp: listener (vd: gửi log) gây lỗi -> lỗi đó lại được báo -> listener lại lỗi…
  if (reporting) return;
  reporting = true;
  try {
    history.push(error);
    if (history.length > MAX_HISTORY) history.splice(MAX_HISTORY / 2, 1);
    listeners.forEach((listener) => callListener(listener, error));
  } finally {
    reporting = false;
  }
}

/**
 * Đăng ký nhận lỗi. Mặc định phát lại các lỗi đã xảy ra trước khi đăng ký,
 * để lỗi lúc khởi động không bị mất.
 */
export function onError(listener: ErrorListener, { replay = true }: { replay?: boolean } = {}) {
  if (replay) history.forEach((error) => callListener(listener, error));
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function inGuard() {
  return guardStack.length > 0;
}

export interface GuardOptions {
  name?: string;
  onError?: (error: NormalizedError) => void;
}

export function applyWithGuard<A extends unknown[], R>(
  fn: (...args: A) => R,
  thisArg: unknown,
  args: A,
  options: GuardOptions = {},
): R | undefined {
  guardStack.push(options.name ?? (fn.name ? `func_name:${fn.name}` : '<anonymous guard>'));
  try {
    if (errorGuardConfig.noCatch) return fn.apply(thisArg, args);
    try {
      return fn.apply(thisArg, args);
    } catch (thrown) {
      const normalized = normalizeError(thrown, 'GUARDED', [...guardStack]);
      // onError do người dùng truyền vào cũng có thể ném lỗi; không được để nó phá lời hứa
      // "lỗi không lọt ra ngoài guard".
      if (options.onError) callListener(options.onError, normalized);
      reportNormalizedError(normalized);
      return undefined;
    }
  } finally {
    guardStack.pop();
  }
}

export function guard<A extends unknown[], R>(fn: (...args: A) => R, options: GuardOptions = {}) {
  return function (this: unknown, ...args: A) {
    return applyWithGuard(fn, this, args, options);
  };
}

/** Bắt cả lỗi lọt ra ngoài mọi guard. Gọi một lần lúc khởi động app. */
export function installGlobalErrorHandlers() {
  const onWindowError = (event: ErrorEvent) => {
    if (event.error == null) {
      // Lỗi từ script khác origin thiếu `crossorigin` + header CORS: trình duyệt giấu hết
      // chi tiết, chỉ còn message "Script error.". Báo đúng bản chất thay vì "Non-error thrown".
      const error = new Error(event.message || 'Script error.');
      error.name = 'OpaqueScriptError';
      error.stack = `${event.filename || '(unknown)'}:${event.lineno}:${event.colno}`;
      reportNormalizedError(normalizeError(error, 'GLOBAL'));
      return;
    }
    reportNormalizedError(normalizeError(event.error, 'GLOBAL'));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportNormalizedError(normalizeError(event.reason, 'UNHANDLED_REJECTION'));
  };
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}

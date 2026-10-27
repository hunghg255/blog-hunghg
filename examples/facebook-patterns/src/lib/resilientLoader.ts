/**
 * Tải JS/CSS động bền bỉ (ý tưởng từ Bootloader + CSSLoader của Facebook).
 *
 * - <link rel="preload"> trước, rồi mới tới thẻ thật: trình duyệt bắt đầu tải sớm nhất có thể.
 * - Script lỗi: thử lại sau [200, 500]ms (giá trị jsRetries của Facebook).
 * - Ngắt mạch: nếu `breakerCount` lần retry dồn vào trong `breakerWindowMs` (rất nhiều file lỗi
 *   CÙNG LÚC = mất mạng/CDN sập) thì tắt retry cho cả trang, tránh "bão" request vô ích.
 * - CSS: biết chắc CSS đã ÁP DỤNG bằng một rule "lính gác" (sentinel) trong chính file CSS,
 *   kiểm tra bằng getComputedStyle mỗi 20ms, có timeout.
 */

export type LoaderEvent =
  | { type: 'preload'; name: string; url: string }
  | { type: 'attempt'; name: string; url: string; attempt: number }
  | { type: 'retry'; name: string; attempt: number; delay: number }
  | { type: 'breaker-open'; name: string }
  | { type: 'success'; name: string; ms: number; attempts: number }
  | { type: 'error'; name: string; ms: number; attempts: number }
  | { type: 'css-applied'; name: string; ms: number }
  | { type: 'css-timeout'; name: string; ms: number };

export interface ResilientLoaderOptions {
  retryDelays?: number[];
  /** số lần retry tối thiểu nằm trong cửa sổ để ngắt mạch */
  breakerCount?: number;
  breakerWindowMs?: number;
  cssTimeoutMs?: number;
  cssPollMs?: number;
  preload?: boolean;
  onEvent?: (event: LoaderEvent) => void;
}

/** id của phần tử lính gác cho một stylesheet */
export const sentinelId = (name: string) => `css_sentinel_${name.replace(/[^a-z0-9]/gi, '_')}`;
/** rule cần chèn vào cuối file CSS lúc build (Facebook: #bootloader_<hash>{height:42px}) */
export const sentinelRule = (name: string) => `#${sentinelId(name)}{height:42px}`;

type UrlSource = string | ((attempt: number) => string);
const resolveUrl = (src: UrlSource, attempt: number) => (typeof src === 'function' ? src(attempt) : src);

export function createResilientLoader({
  retryDelays = [200, 500],
  breakerCount = 2,
  breakerWindowMs = 5,
  cssTimeoutMs = 5000,
  cssPollMs = 20,
  preload = true,
  onEvent,
}: ResilientLoaderOptions = {}) {
  const retryTimes: number[] = [];
  let retriesEnabled = true;
  const preloaded = new Set<string>();

  /** Còn được phép retry không? Đồng thời là "cầu dao": nhiều retry dồn dập thì ngắt hẳn. */
  function canRetry(name: string) {
    if (!retriesEnabled) return false;
    if (retryTimes.length < breakerCount) return true;
    const span = retryTimes[retryTimes.length - 1] - retryTimes[retryTimes.length - breakerCount];
    if (span < breakerWindowMs) {
      retriesEnabled = false;
      onEvent?.({ type: 'breaker-open', name });
    }
    return retriesEnabled;
  }

  function preloadOnce(name: string, url: string, as: 'script' | 'style') {
    if (!preload || preloaded.has(url)) return;
    preloaded.add(url);
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = as;
    link.href = url;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
    onEvent?.({ type: 'preload', name, url });
  }

  function loadScript(name: string, src: UrlSource): Promise<void> {
    preloadOnce(name, resolveUrl(src, 0), 'script');
    const start = performance.now();
    return new Promise((resolve, reject) => {
      let attempt = 0;
      const inject = () => {
        const url = resolveUrl(src, attempt);
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.crossOrigin = 'anonymous';
        onEvent?.({ type: 'attempt', name, url, attempt });
        script.onload = () => {
          onEvent?.({ type: 'success', name, ms: Math.round(performance.now() - start), attempts: attempt + 1 });
          resolve();
        };
        script.onerror = () => {
          if (attempt < retryDelays.length && canRetry(name)) {
            retryTimes.push(performance.now());
            const delay = retryDelays[attempt];
            attempt++;
            onEvent?.({ type: 'retry', name, attempt, delay });
            setTimeout(() => {
              // kiểm tra lại: trong lúc chờ có thể cầu dao đã ngắt vì file khác
              if (!canRetry(name)) return fail();
              // thẻ <script> đã lỗi không tải lại được, phải tạo thẻ mới
              script.remove();
              inject();
            }, delay);
          } else {
            fail();
          }
        };
        document.head.appendChild(script);
      };
      const fail = () => {
        onEvent?.({ type: 'error', name, ms: Math.round(performance.now() - start), attempts: attempt + 1 });
        reject(new Error(`Không tải được script "${name}"`));
      };
      inject();
    });
  }

  // ---- CSS: một vòng poll dùng chung cho mọi stylesheet đang chờ ----
  const pendingCss = new Map<
    string,
    { meta: HTMLMetaElement; start: number; resolve: () => void; reject: (error: Error) => void }
  >();
  let deadline = 0;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  function poll() {
    const now = performance.now();
    if (now >= deadline) {
      // Không có stylesheet nào về trong `cssTimeoutMs` gần nhất: coi như tất cả đều lỗi.
      pendingCss.forEach(({ meta, start, reject }, name) => {
        meta.remove();
        onEvent?.({ type: 'css-timeout', name, ms: Math.round(now - start) });
        reject(new Error(`CSS "${name}" không được áp dụng sau ${cssTimeoutMs}ms`));
      });
      pendingCss.clear();
    } else {
      pendingCss.forEach(({ meta, start, resolve }, name) => {
        // <meta> mặc định display:none, nhưng getComputedStyle vẫn trả về giá trị đã tính
        // của height: '42px' khi rule sentinel đã được áp dụng, 'auto' khi chưa.
        if (parseInt(getComputedStyle(meta).height, 10) > 1) {
          meta.remove();
          pendingCss.delete(name);
          // có tiến triển -> gia hạn cho các file còn lại (giống CSSLoader của FB)
          deadline = now + cssTimeoutMs;
          onEvent?.({ type: 'css-applied', name, ms: Math.round(now - start) });
          resolve();
        }
      });
    }
    if (pendingCss.size === 0) {
      clearInterval(pollTimer);
      pollTimer = undefined;
    }
  }

  function waitForSentinel(name: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const meta = document.createElement('meta');
      meta.id = sentinelId(name);
      document.head.appendChild(meta);
      deadline = performance.now() + cssTimeoutMs;
      pendingCss.set(name, { meta, start: performance.now(), resolve, reject });
      pollTimer ??= setInterval(poll, cssPollMs);
    });
  }

  /**
   * detect:
   * - 'event': dùng link.onload/onerror (trình duyệt hiện đại đều hỗ trợ)
   * - 'sentinel': kiểm tra rule lính gác; dùng khi không tin được sự kiện load
   *   (CSS nạp qua @import, CSS-in-JS, trình duyệt cũ) hoặc muốn chắc rule đã ÁP DỤNG.
   */
  function loadStyle(name: string, href: string, { detect = 'event' as 'event' | 'sentinel' } = {}) {
    preloadOnce(name, href, 'style');
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    const start = performance.now();
    const done =
      detect === 'sentinel'
        ? waitForSentinel(name)
        : new Promise<void>((resolve, reject) => {
            link.onload = () => {
              onEvent?.({ type: 'css-applied', name, ms: Math.round(performance.now() - start) });
              resolve();
            };
            link.onerror = () => reject(new Error(`Không tải được CSS "${name}"`));
          });
    document.head.appendChild(link);
    return done;
  }

  return {
    loadScript,
    loadStyle,
    isRetryEnabled: () => retriesEnabled,
  };
}

/**
 * Retry cho dynamic import(). Theo spec HTML, một module tải lỗi có thể bị ghi nhớ trong
 * "module map", nên import lại ĐÚNG URL cũ có thể thất bại ngay mà không gửi request.
 * Vì vậy factory nhận số lần thử để có thể đổi URL (vd: thêm ?retry=n).
 */
export async function importWithRetry<T>(
  factory: (attempt: number) => Promise<T>,
  { retryDelays = [200, 500], onRetry }: { retryDelays?: number[]; onRetry?: (attempt: number, error: unknown) => void } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await factory(attempt);
    } catch (error) {
      if (attempt >= retryDelays.length) throw error;
      onRetry?.(attempt + 1, error);
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt]));
    }
  }
}

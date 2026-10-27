/**
 * Đo thời điểm phần đầu màn hình (above the fold) hiển thị xong, cả lần tải trang lẫn chuyển trang trong SPA
 * (ý tưởng từ zappos.com: src/helpers/LatencyTracking.js).
 *
 * "Xong" = DOM trong vùng gốc đã yên (không đổi trong `quietMs`) VÀ mọi ảnh đang nằm trong khung nhìn đã tải xong.
 * Khác bản Zappos:
 * - Ghi thời điểm từng ảnh tải xong ngay khi nó xảy ra, nên không phải trừ hú hoạ thời gian chờ.
 * - Không có ảnh nào trong khung nhìn vẫn ra kết quả (Zappos thì không bao giờ gửi).
 * - Mỗi lần đo có AbortController riêng: listener của lần đo trước không đếm nhầm sang lần sau.
 */

export interface AboveFoldResult {
  /** mốc bắt đầu (performance.now), 0 = lúc bắt đầu tải trang */
  startedAt: number;
  /** lần cuối DOM đổi trước khi yên */
  domStableAt: number;
  /** ảnh cuối cùng trong khung nhìn tải xong (bằng startedAt nếu không có ảnh) */
  imagesDoneAt: number;
  /** kết quả: max(domStableAt, imagesDoneAt) - startedAt, đơn vị ms */
  aboveTheFold: number;
  imageCount: number;
  timedOut: boolean;
}

export interface MeasureOptions {
  root: Element;
  /** mốc bắt đầu, mặc định là lúc gọi hàm. Lần tải trang đầu tiên thì truyền 0. */
  startedAt?: number;
  /** DOM không đổi trong khoảng này thì coi là đã yên (Zappos: 1000ms) */
  quietMs?: number;
  /** chờ ảnh tối đa bao lâu */
  timeoutMs?: number;
}

/** Ảnh có nằm (ít nhất một phần) trong khung nhìn và đang hiện không. */
export function isInViewport(el: Element) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.right < 0 || rect.top > innerHeight || rect.left > innerWidth) return false;
  return getComputedStyle(el).visibility !== 'hidden';
}

export function measureAboveTheFold({
  root,
  startedAt = performance.now(),
  quietMs = 1000,
  timeoutMs = 15000,
}: MeasureOptions) {
  const controller = new AbortController();
  const { signal } = controller;
  // thời điểm từng ảnh tải xong; undefined = đang tải
  const loadedAt = new Map<HTMLImageElement, number | undefined>();
  let lastMutationAt = startedAt;
  let quietTimer = 0;
  let timeoutTimer = 0;
  let settle: (() => void) | null = null;

  const track = (img: HTMLImageElement) => {
    // <img> chưa có src (ảnh lazy-load chưa tới lượt) cũng có complete = true: coi là đang chờ, không phải đã xong
    const hasSource = Boolean(img.getAttribute('src') || img.getAttribute('srcset'));
    if (img.complete && hasSource) {
      // đã có sẵn (cache hoặc data URL): coi như xong lúc mình nhìn thấy nó
      loadedAt.set(img, performance.now());
      return;
    }
    loadedAt.set(img, undefined);
    const done = () => {
      loadedAt.set(img, performance.now());
      settle?.();
    };
    // lỗi tải cũng tính là "xong": ảnh hỏng không được làm kết quả treo mãi
    img.addEventListener('load', done, { once: true, signal });
    img.addEventListener('error', done, { once: true, signal });
  };
  const scan = () => root.querySelectorAll('img').forEach((img) => loadedAt.has(img) || track(img));

  const result = new Promise<AboveFoldResult>((resolve) => {
    const finish = (timedOut: boolean) => {
      const visible = [...loadedAt.keys()].filter(isInViewport);
      const times = visible.map((img) => loadedAt.get(img));
      if (!timedOut && times.some((t) => t === undefined)) return; // còn ảnh đang tải
      const imagesDoneAt = Math.max(startedAt, ...times.map((t) => t ?? performance.now()));
      controller.abort();
      clearTimeout(timeoutTimer);
      resolve({
        startedAt,
        domStableAt: lastMutationAt,
        imagesDoneAt,
        aboveTheFold: Math.max(lastMutationAt, imagesDoneAt) - startedAt,
        imageCount: visible.length,
        timedOut,
      });
    };

    const observer = new MutationObserver((records) => {
      lastMutationAt = performance.now();
      for (const record of records) {
        // React có thể dùng lại thẻ <img> cũ và chỉ đổi src: theo dõi lại từ đầu
        if (record.type === 'attributes' && record.target instanceof HTMLImageElement) loadedAt.delete(record.target);
      }
      scan();
      clearTimeout(quietTimer);
      quietTimer = window.setTimeout(onQuiet, quietMs);
    });
    const onQuiet = () => {
      observer.disconnect();
      settle = () => finish(false);
      finish(false);
    };

    observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'srcset'] });
    signal.addEventListener('abort', () => {
      observer.disconnect();
      clearTimeout(quietTimer);
      clearTimeout(timeoutTimer);
    });
    scan();
    // hẹn giờ ngay từ đầu: nếu DOM đã render xong trước khi bắt đầu đo thì vẫn có kết quả
    quietTimer = window.setTimeout(onQuiet, quietMs);
    timeoutTimer = window.setTimeout(() => finish(true), timeoutMs);
  });

  return { result, cancel: () => controller.abort() };
}

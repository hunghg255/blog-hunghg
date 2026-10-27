/**
 * Để CSS là nơi duy nhất định nghĩa breakpoint, JS chỉ việc đọc lại:
 * - mẹo của Ello: đặt z-index của #root::after theo media query, JS đọc z-index đó = số cột.
 * - cách hiện đại: custom property (--columns), kèm container query.
 * Và phát hiện app đang chạy như PWA hay trong tab trình duyệt (ý tưởng từ App Store web).
 */

/** Ello: z-index của pseudo-element là một số nguyên "vô hại", dùng làm kênh truyền dữ liệu CSS -> JS. */
export function readZIndexProbe(el: Element, pseudo = '::after', fallback = 2): number {
  const value = getComputedStyle(el, pseudo).getPropertyValue('z-index');
  // Bản gốc ghi chú: máy HTC One trả 'auto'. Không phải số thì dùng giá trị mặc định.
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Cách hiện đại: CSS khai báo --columns: 3; JS đọc lại. Đọc được cả chuỗi, không chỉ số nguyên. */
export function readCssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function readCssNumber(el: Element, name: string, fallback: number): number {
  const n = parseFloat(readCssVar(el, name));
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Theo dõi một giá trị đọc từ CSS. ResizeObserver trên đúng phần tử chứa (không phải window),
 * nên container query hay sidebar thu/mở cũng được tính. Gộp về một lần đọc mỗi frame và
 * chỉ gọi onChange khi giá trị đổi thật.
 */
export function observeCssValue<T>(container: Element, read: () => T, onChange: (value: T) => void): () => void {
  let last: T | undefined;
  let frame = 0;
  const check = () => {
    frame = 0;
    const value = read();
    if (!Object.is(value, last)) {
      last = value;
      onChange(value);
    }
  };
  const observer = new ResizeObserver(() => {
    if (!frame) frame = requestAnimationFrame(check);
  });
  observer.observe(container);
  check();
  return () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
  };
}

/**
 * Cách của Ello để so sánh: nghe window.resize, debounce 100ms rồi đợi thêm một frame.
 * Không biết gì khi chỉ phần tử chứa đổi kích thước (kéo sidebar, mở panel).
 */
export function watchWindowResize<T>(read: () => T, onChange: (value: T) => void, delay = 100): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ticking = false;
  const run = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      onChange(read());
    });
  };
  const onResize = () => {
    clearTimeout(timer);
    timer = setTimeout(run, delay);
  };
  window.addEventListener('resize', onResize);
  run();
  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', onResize);
  };
}

/** Ello tính độ rộng cột từ số cột đọc được (selectors/gui.js): chừa padding ở hai mép và giữa các cột. */
export function columnWidth(containerWidth: number, columns: number, gap: number): number {
  return Math.round((containerWidth - (columns + 1) * gap) / columns);
}

// ---------- PWA display mode ----------

export type DisplayMode = 'twa' | 'browser' | 'standalone' | 'minimal-ui' | 'fullscreen' | 'window-controls-overlay' | 'unknown';

const MODES: Exclude<DisplayMode, 'twa' | 'unknown'>[] = ['window-controls-overlay', 'fullscreen', 'standalone', 'minimal-ui', 'browser'];

/**
 * App Store web gọi một lần lúc khởi động để gắn vào sự kiện analytics "enter".
 * Bản này thêm navigator.standalone (thuộc tính riêng của Safari iOS cho web app thêm vào màn hình chính).
 */
export function getDisplayMode(win: Window = window): DisplayMode {
  // Trusted Web Activity (app Android bọc PWA): lần mở đầu có referrer android-app://<package>
  if (win.document.referrer.startsWith('android-app://')) return 'twa';
  if ((win.navigator as Navigator & { standalone?: boolean }).standalone === true) return 'standalone';
  for (const mode of MODES) {
    if (win.matchMedia(`(display-mode: ${mode})`).matches) return mode;
  }
  return 'unknown';
}

/** display-mode có thể đổi khi đang chạy, ví dụ PWA trên desktop bật/tắt thanh tiêu đề tuỳ biến (window-controls-overlay). */
export function watchDisplayMode(onChange: (mode: DisplayMode) => void): () => void {
  const lists = MODES.map((mode) => matchMedia(`(display-mode: ${mode})`));
  const handler = () => onChange(getDisplayMode());
  lists.forEach((list) => list.addEventListener('change', handler));
  return () => lists.forEach((list) => list.removeEventListener('change', handler));
}

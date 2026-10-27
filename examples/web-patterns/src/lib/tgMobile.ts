/**
 * Chiều cao viewport trên mobile và phát hiện bàn phím ảo
 * (ý tưởng từ util/windowSize.ts của Telegram Web A).
 *
 * - `100vh` trên mobile là chiều cao khi thanh địa chỉ ĐÃ thu gọn, nên phần đáy trang
 *   (ô nhập tin nhắn) bị che. Telegram ghi `--vh = innerHeight / 100` vào :root mỗi lần
 *   resize, CSS dùng `calc(var(--vh, 1vh) * 100)`.
 * - Bàn phím ảo: Telegram coi "chiều cao hiện tại < chiều cao lúc tải" là bàn phím đang mở.
 *   Bản này so với chiều cao lớn nhất đã thấy THEO TỪNG HƯỚNG màn hình, và dùng
 *   visualViewport nếu có (iOS không co innerHeight khi bàn phím mở).
 */

export type Layout = 'single-column' | 'two-columns';

/** Ngưỡng của Telegram: ≤ 600px rộng, hoặc nằm ngang thấp (≤ 950 × 450) là 1 cột. */
export const MOBILE_MAX_WIDTH = 600;
export const MOBILE_LANDSCAPE_MAX_WIDTH = 950;
export const MOBILE_LANDSCAPE_MAX_HEIGHT = 450;

export function getLayout(width: number, height: number): Layout {
  const isMobile =
    width <= MOBILE_MAX_WIDTH ||
    (width <= MOBILE_LANDSCAPE_MAX_WIDTH && height <= MOBILE_LANDSCAPE_MAX_HEIGHT);
  return isMobile ? 'single-column' : 'two-columns';
}

/** Bàn phím ảo hiếm khi thấp hơn ngần này; chênh ít hơn thì là thanh địa chỉ co giãn. */
export const KEYBOARD_MIN_HEIGHT = 150;

export interface ViewportState {
  /** chiều cao layout viewport (window.innerHeight) */
  innerHeight: number;
  /** chiều cao vùng thực sự nhìn thấy (visualViewport.height), iOS co lại khi bàn phím mở */
  visibleHeight: number;
  width: number;
  orientation: 'portrait' | 'landscape';
  layout: Layout;
  /** ước lượng chiều cao bàn phím ảo, 0 nếu đang đóng */
  keyboardHeight: number;
}

export interface KeyboardDetector {
  /** đưa vào số đo hiện tại, trả về chiều cao bàn phím ước lượng */
  measure(width: number, height: number): number;
}

/**
 * Nhớ chiều cao lớn nhất đã thấy cho từng hướng màn hình.
 * Bản gốc chỉ nhớ `initialHeight` lúc tải: xoay ngang rồi xoay dọc lại vẫn đúng,
 * nhưng tải trang lúc ĐANG nằm ngang rồi xoay dọc thì mọi chiều cao dọc đều lớn hơn
 * initialHeight, nên không bao giờ thấy bàn phím.
 */
export function createKeyboardDetector(minHeight = KEYBOARD_MIN_HEIGHT): KeyboardDetector {
  const maxByOrientation = { portrait: 0, landscape: 0 };
  return {
    measure(width, height) {
      const orientation = width > height ? 'landscape' : 'portrait';
      if (height > maxByOrientation[orientation]) maxByOrientation[orientation] = height;
      const diff = maxByOrientation[orientation] - height;
      return diff >= minHeight ? diff : 0;
    },
  };
}

export interface ViewportWatcherOptions {
  /** phần tử nhận biến CSS, mặc định <html> */
  target?: HTMLElement;
  /** gọi khi layout 1 cột ⇄ 2 cột đổi (Telegram thì reload cả trang) */
  onLayoutChange?: (layout: Layout, previous: Layout) => void;
  onChange?: (state: ViewportState) => void;
  throttleMs?: number;
}

/**
 * Ghi `--vh` (theo innerHeight, giống Telegram) và `--visible-vh`, `--keyboard-height`
 * (theo visualViewport) lên :root. Trả về hàm huỷ.
 */
export function watchViewport({
  target = document.documentElement,
  onLayoutChange,
  onChange,
  throttleMs = 100,
}: ViewportWatcherOptions = {}) {
  const detector = createKeyboardDetector();
  let layout = getLayout(window.innerWidth, window.innerHeight);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const update = () => {
    timer = undefined;
    const vv = window.visualViewport;
    const innerHeight = window.innerHeight;
    const width = window.innerWidth;
    // phóng to bằng hai ngón cũng làm visualViewport.height nhỏ lại: khi đó bỏ qua nó
    const isZoomed = vv !== null && vv !== undefined && vv.scale > 1.01;
    const visibleHeight = vv && !isZoomed ? vv.height : innerHeight;
    // Android co innerHeight khi bàn phím mở, iOS chỉ co visualViewport: lấy số nhỏ hơn
    const keyboardHeight = detector.measure(width, Math.min(innerHeight, visibleHeight));

    target.style.setProperty('--vh', `${innerHeight * 0.01}px`);
    target.style.setProperty('--visible-vh', `${visibleHeight * 0.01}px`);
    target.style.setProperty('--keyboard-height', `${keyboardHeight}px`);

    const nextLayout = getLayout(width, innerHeight);
    if (nextLayout !== layout) {
      const previous = layout;
      layout = nextLayout;
      onLayoutChange?.(nextLayout, previous);
    }

    onChange?.({
      innerHeight,
      visibleHeight,
      width,
      orientation: width > innerHeight ? 'landscape' : 'portrait',
      layout,
      keyboardHeight,
    });
  };

  // throttle kiểu "chạy cuối": resize bắn hàng chục lần khi xoay máy
  const schedule = () => {
    if (timer === undefined) timer = setTimeout(update, throttleMs);
  };

  update();
  window.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('resize', schedule);

  return () => {
    clearTimeout(timer);
    window.removeEventListener('resize', schedule);
    window.visualViewport?.removeEventListener('resize', schedule);
  };
}

/**
 * Màn tải đầu tiên kiểu Telegram Web A (components/common/UiLoader.tsx):
 * chạy preload (bundle, font, vài avatar) nhưng KHÔNG chờ quá `maxDelay` ms.
 * Hết giờ thì vẫn bỏ mặt nạ, preload tiếp tục chạy nền.
 *
 * Trạng thái sẵn sàng có 3 nấc:
 *   0: đang tải, mặt nạ (khung 3 cột giả) phủ lên app
 *   1: bỏ mặt nạ (fade)
 *   2: thêm `secondStateDelay` ms nữa, gỡ class "initial" để bật lại các animation lần đầu
 */

export type ReadyState = 0 | 1 | 2;
export type PreloadOutcome = 'done' | 'timeout' | 'error';

export interface UiLoaderOptions {
  preload: () => Promise<unknown>;
  /** thời gian chờ tối đa trước khi bỏ mặt nạ, Telegram dùng 700ms */
  maxDelay?: number;
  /** khoảng cách giữa nấc 1 và nấc 2, Telegram dùng 1000ms */
  secondStateDelay?: number;
  onReadyState: (state: ReadyState, info: { outcome?: PreloadOutcome; elapsed: number }) => void;
}

const pause = (ms: number) => new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), ms));

/** Bắt đầu tải. Trả về hàm huỷ (gọi khi unmount hoặc đổi trang). */
export function startUiLoader({
  preload,
  maxDelay = 700,
  secondStateDelay = 1000,
  onReadyState,
}: UiLoaderOptions): () => void {
  const startedAt = performance.now();
  let cancelled = false;
  let secondTimer: ReturnType<typeof setTimeout> | undefined;

  // lỗi preload không được chặn app: coi như xong, app tự tải phần thiếu sau
  const safePreload = preload().then(
    () => 'done' as const,
    () => 'error' as const,
  );

  onReadyState(0, { elapsed: 0 });

  void Promise.race([pause(maxDelay), safePreload]).then((outcome) => {
    // Bản gốc thiếu kiểm tra này: unmount trước khi race xong thì vẫn
    // đặt nấc 1 rồi hẹn nấc 2, sau khi cleanup đã đặt về 0.
    if (cancelled) return;
    onReadyState(1, { outcome, elapsed: performance.now() - startedAt });
    secondTimer = setTimeout(() => {
      if (!cancelled) onReadyState(2, { elapsed: performance.now() - startedAt });
    }, secondStateDelay);
  });

  return () => {
    cancelled = true;
    clearTimeout(secondTimer);
  };
}

// ---- Ba mức animation bằng class trên phần tử gốc ----

export type AnimationLevel = 0 | 1 | 2;

export const ANIMATION_LEVELS: Record<AnimationLevel, string> = {
  0: 'Tắt hết',
  1: 'Vừa phải',
  2: 'Đầy đủ',
};

/** Đặt đúng một class `animation-level-N` trên `root` (Telegram dùng `document.body`). */
export function applyAnimationLevel(level: AnimationLevel, root: HTMLElement = document.body) {
  for (const l of [0, 1, 2] as const) {
    root.classList.toggle(`animation-level-${l}`, l === level);
  }
}

/**
 * Mức mặc định: người dùng đã chọn thì theo lựa chọn đó, chưa chọn thì
 * tôn trọng `prefers-reduced-motion` (bản gốc không đọc media query này).
 */
export function resolveAnimationLevel(saved: AnimationLevel | undefined, fallback: AnimationLevel = 2): AnimationLevel {
  if (saved !== undefined) return saved;
  if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  return fallback;
}

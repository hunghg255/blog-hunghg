import {
  createElement,
  lazy,
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

/**
 * Preload code + data khi người dùng có "ý định" bấm (hover, focus, nhấn xuống),
 * lấy ý tưởng từ useCometPreloader / useCometPrerenderer của Facebook.
 */

export type PreloadableComponent<T extends ComponentType<any>> = ComponentType<
  ComponentProps<T>
> & {
  preload: () => Promise<{ default: T }>;
};

/**
 * React.lazy kèm hàm `preload()` để tải trước chunk JS.
 *
 * Lưu ý: lazy() luôn suspend ở lần render đầu, kể cả khi chunk đã tải xong, và React
 * throttle việc hiện lại nội dung sau Suspense (~300ms). Vì vậy khi module đã có sẵn,
 * ta render thẳng component thật, bỏ qua lazy.
 */
export function lazyWithPreload<T extends ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): PreloadableComponent<T> {
  let promise: Promise<{ default: T }> | null = null;
  let loaded: T | null = null;
  const load = () => {
    promise ??= factory().then(
      (module) => {
        loaded = module.default;
        return module;
      },
      (error) => {
        promise = null; // lỗi mạng thì lần sau được thử lại
        throw error;
      },
    );
    return promise;
  };
  const LazyComponent = lazy(load);

  function Preloadable(props: ComponentProps<T>) {
    return createElement(loaded ?? LazyComponent, props);
  }
  return Object.assign(Preloadable, { preload: load });
}

type TrackedPromise<T> = Promise<T> & { status?: string; value?: T; reason?: unknown };

/**
 * Cache promise theo key để vừa preload được, vừa dùng được với `use()` / Suspense.
 * Gắn `status`/`value` lên promise: `use()` của React đọc 2 field này, thấy promise
 * đã xong thì trả về giá trị ngay, không suspend.
 */
export function createResource<T>(fetcher: (key: string) => Promise<T>) {
  const cache = new Map<string, Promise<T>>();
  const read = (key: string): Promise<T> => {
    let promise = cache.get(key);
    if (!promise) {
      const tracked = fetcher(key) as TrackedPromise<T>;
      tracked.status = 'pending';
      tracked.then(
        (value) => {
          tracked.status = 'fulfilled';
          tracked.value = value;
        },
        (reason) => {
          tracked.status = 'rejected';
          tracked.reason = reason;
          cache.delete(key);
        },
      );
      cache.set(key, tracked);
      promise = tracked;
    }
    return promise;
  };
  return { read, preload: (key: string) => void read(key) };
}

export interface UsePreloadOnHoverOptions {
  /** chờ bao lâu khi hover thì mới preload, để lướt chuột qua không tốn request */
  delay?: number;
  /**
   * Phần "đắt" (data lớn, ảnh…) chỉ tải khi ý định mạnh hơn: nhấn chuột/ngón tay xuống, hoặc
   * Enter/Space. Giống chế độ "button" của Facebook: hover tải phần rẻ, nhấn mới tải phần đắt.
   */
  preloadOnPress?: () => void;
}

/**
 * Trả về các event handler để gắn vào nút/link.
 * - Chuột: hover đủ `delay` ms mới preload, rời chuột trước đó thì huỷ.
 * - Cảm ứng: không có hover -> preload ngay khi ngón tay chạm xuống (trước click ~100ms).
 * - Bàn phím: preload khi focus.
 */
export function usePreloadOnHover(
  preload: () => void,
  { delay = 50, preloadOnPress }: UsePreloadOnHoverOptions = {},
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "latest ref": handler ổn định nhưng luôn gọi hàm preload mới nhất. Dùng useEffect là đủ
  // vì ref chỉ được đọc trong event handler, không đọc trong lúc render hay layout.
  const preloadRef = useRef(preload);
  const pressRef = useRef(preloadOnPress);
  useEffect(() => {
    preloadRef.current = preload;
    pressRef.current = preloadOnPress;
  });

  const cancel = useCallback(() => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback(
    (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      cancel();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        preloadRef.current();
      }, delay);
    },
    [cancel, delay],
  );

  const onPointerDown = useCallback(() => {
    cancel();
    preloadRef.current();
    pressRef.current?.();
  }, [cancel]);

  const onFocus = useCallback(() => preloadRef.current(), []);

  const onKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      preloadRef.current();
      pressRef.current?.();
    }
  }, []);

  return { onPointerEnter, onPointerLeave: cancel, onPointerDown, onFocus, onKeyDown };
}

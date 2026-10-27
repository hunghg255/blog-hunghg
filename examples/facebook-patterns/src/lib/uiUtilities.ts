import { useCallback, useEffect, useLayoutEffect, useReducer, useRef } from 'react';

/* -------------------------------------------------------------------------- */
/* 1. useFadeEffect: giữ phần tử trong DOM tới khi fade-out xong               */
/* -------------------------------------------------------------------------- */

/**
 * Ý tưởng từ useFadeEffect của Facebook: trả về [shouldRender, isVisible, ref].
 * - Đổi trạng thái trong requestAnimationFrame để trình duyệt kịp áp style ban đầu
 *   (không thì transition không chạy, phần tử hiện ra ngay).
 * - Kết thúc khi `transitionend`, kèm một timeout dự phòng: nếu transitionend không bao giờ
 *   bắn (phần tử bị display:none, transition bị tắt, tab ẩn…), phần tử vẫn được gỡ.
 * Khác bản gốc: timeout chỉnh được, chỉ nhận transitionend của chính phần tử (không phải con),
 * và bỏ qua animation khi người dùng bật prefers-reduced-motion.
 */
type FadeState = { transitioning: boolean; visible: boolean };
type FadeAction = { type: 'start'; visible: boolean } | { type: 'finish' };

function fadeReducer(state: FadeState, action: FadeAction): FadeState {
  if (action.type === 'start') return { transitioning: true, visible: action.visible };
  return { transitioning: false, visible: state.visible };
}

export function useFadeEffect(show: boolean, { fallbackMs = 1000 }: { fallbackMs?: number | null } = {}) {
  const [state, dispatch] = useReducer(fadeReducer, { transitioning: false, visible: false });
  const node = useRef<HTMLElement | null>(null);
  const raf = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevShow = useRef(false);

  const finish = useCallback(() => {
    if (timer.current != null) clearTimeout(timer.current);
    timer.current = null;
    dispatch({ type: 'finish' });
  }, []);

  const start = useCallback(
    (visible: boolean) => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() => {
        raf.current = null;
        dispatch({ type: 'start', visible });
        if (timer.current != null) clearTimeout(timer.current);
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        // fallbackMs = null: chỉ dựa vào transitionend (để demo trường hợp bị kẹt)
        if (reduced) timer.current = setTimeout(finish, 0);
        else if (fallbackMs != null) timer.current = setTimeout(finish, fallbackMs);
      });
    },
    [fallbackMs, finish],
  );

  useLayoutEffect(() => {
    // lúc mở: chờ ref có node (callback ref bên dưới sẽ gọi start); lúc đóng: bắt đầu ngay
    if (prevShow.current !== show && (!show || node.current != null)) start(show);
    prevShow.current = show;
  }, [show, start]);

  useEffect(
    () => () => {
      if (raf.current != null) cancelAnimationFrame(raf.current);
      if (timer.current != null) clearTimeout(timer.current);
    },
    [],
  );

  const onTransitionEnd = useCallback(
    (event: Event) => {
      if (event.target === event.currentTarget) finish();
    },
    [finish],
  );

  const ref = useCallback(
    (el: HTMLElement | null) => {
      node.current?.removeEventListener('transitionend', onTransitionEnd);
      node.current = el;
      if (el) {
        el.addEventListener('transitionend', onTransitionEnd);
        if (prevShow.current) start(true);
      }
    },
    [onTransitionEnd, start],
  );

  const shouldRender = state.transitioning || state.visible || show;
  return [shouldRender, state.visible, ref] as const;
}

/* -------------------------------------------------------------------------- */
/* 2. Sticky event: người đăng ký muộn vẫn nhận sự kiện đã xảy ra             */
/* -------------------------------------------------------------------------- */

/**
 * Ý tưởng từ EventHolder + EventEmitterWithHolding: emitter có thể "giữ" sự kiện;
 * listener đăng ký bằng addRetroactiveListener nhận lại các sự kiện đang được giữ.
 * Khác bản gốc: chỉ giữ sự kiện MỚI NHẤT của mỗi loại (bản gốc giữ hết, mảng phình dần,
 * và release bằng `delete` để lại lỗ trong mảng).
 */
export function createStickyEmitter<Events extends Record<string, unknown>>() {
  type Listener<K extends keyof Events> = (payload: Events[K]) => void;
  const listeners = new Map<keyof Events, Set<Listener<keyof Events>>>();
  const held = new Map<keyof Events, Events[keyof Events]>();

  return {
    emit<K extends keyof Events>(type: K, payload: Events[K]) {
      listeners.get(type)?.forEach((fn) => fn(payload));
    },
    /** phát và giữ lại để listener đến sau vẫn nhận được */
    emitAndHold<K extends keyof Events>(type: K, payload: Events[K]) {
      held.set(type, payload);
      this.emit(type, payload);
    },
    release<K extends keyof Events>(type: K) {
      held.delete(type);
    },
    addListener<K extends keyof Events>(type: K, fn: Listener<K>) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn as Listener<keyof Events>);
      return () => {
        listeners.get(type)?.delete(fn as Listener<keyof Events>);
      };
    },
    /** như addListener, nhưng gọi ngay với sự kiện đang được giữ (nếu có) */
    addRetroactiveListener<K extends keyof Events>(type: K, fn: Listener<K>) {
      const off = this.addListener(type, fn);
      if (held.has(type)) fn(held.get(type) as Events[K]);
      return off;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 3. Hàm huỷ được                                                            */
/* -------------------------------------------------------------------------- */

/**
 * createCancelableFunction của Facebook: bọc callback, `.cancel()` thay đích bằng hàm rỗng.
 * Dùng cho callback bất đồng bộ có thể chạy sau khi component đã unmount, mà không phải
 * rải cờ `isMounted` khắp nơi.
 */
export interface Cancelable<A extends unknown[], R> {
  (...args: A): R | undefined;
  cancel(): void;
  readonly canceled: boolean;
}

export function createCancelableFunction<A extends unknown[], R>(fn: (...args: A) => R): Cancelable<A, R> {
  let target: ((...args: A) => R) | null = fn;
  const wrapped = ((...args: A) => target?.(...args)) as Cancelable<A, R>;
  wrapped.cancel = () => {
    target = null; // nhả tham chiếu tới closure cũ cho GC
  };
  Object.defineProperty(wrapped, 'canceled', { get: () => target === null });
  return wrapped;
}

/* -------------------------------------------------------------------------- */
/* 4. Sentinel tải thêm không bị kẹt                                          */
/* -------------------------------------------------------------------------- */

/**
 * Ý tưởng từ CometInfiniteScrollTrigger: IntersectionObserver chỉ báo khi trạng thái ĐỔI.
 * Nếu trang vừa tải về quá ngắn, sentinel vẫn nằm trong viewport và observer im lặng mãi.
 * Nên nhớ "đang thấy" trong ref, và sau mỗi lần render + paint xong thì kiểm lại.
 *
 * Khác bản gốc: có `maxAutoLoads` để không tải liên tục khi lỗi hoặc khi API trả trang rỗng.
 */
export interface InfiniteTriggerOptions {
  hasMore: boolean;
  isLoading: boolean;
  onLoadMore: () => void;
  rootMargin?: string;
  root?: Element | null;
  /** tắt kiểm lại sau paint để so sánh (cách "ngây thơ") */
  recheckAfterPaint?: boolean;
  /** số lần tự tải liên tiếp tối đa khi người dùng không cuộn */
  maxAutoLoads?: number;
}

export function useInfiniteTrigger<E extends Element>({
  hasMore,
  isLoading,
  onLoadMore,
  rootMargin = '0px',
  root = null,
  recheckAfterPaint = true,
  maxAutoLoads = 20,
}: InfiniteTriggerOptions) {
  const ref = useRef<E>(null);
  const visible = useRef(false);
  const autoLoads = useRef(0);
  const latest = useRef({ hasMore, isLoading, onLoadMore });
  latest.current = { hasMore, isLoading, onLoadMore };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const wasVisible = visible.current;
        visible.current = entry.isIntersecting;
        if (!entry.isIntersecting) {
          autoLoads.current = 0; // người dùng đã cuộn: cho phép tự tải lại
          return;
        }
        const { hasMore, isLoading, onLoadMore } = latest.current;
        if (!wasVisible && hasMore && !isLoading) onLoadMore();
      },
      { root, rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, rootMargin]);

  // sau mỗi lần render: đợi paint xong rồi kiểm lại
  useEffect(() => {
    if (!recheckAfterPaint) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        const { hasMore, isLoading, onLoadMore } = latest.current;
        if (visible.current && hasMore && !isLoading && autoLoads.current < maxAutoLoads) {
          autoLoads.current++;
          onLoadMore();
        }
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  });

  return ref;
}

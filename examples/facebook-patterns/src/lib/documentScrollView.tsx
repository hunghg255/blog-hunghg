import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';

/**
 * Nhiều "màn hình" chồng lên nhau (trang feed, modal permalink, modal lồng trong modal…)
 * nhưng chỉ MỘT màn hình được dùng thanh cuộn thật của `window` (ý tưởng từ
 * CometDocumentScrollView của Facebook).
 *
 * - View nằm SAU CÙNG trong DOM là view "attached": nó nằm trong luồng bình thường, nên
 *   chiều cao document = chiều cao của nó và cuộn trang chính là cuộn nó.
 * - Mọi view khác bị "detached": `position: fixed; top: -scrollY; left: -scrollX`. Nhìn vẫn
 *   y như cũ (đứng yên tại đúng chỗ đang xem), nhưng không còn góp chiều cao vào document.
 * - Khi view trên cùng đóng, view kế tiếp được attach lại và `window.scrollTo()` về đúng
 *   vị trí đã lưu.
 */

type SetAttached = (attached: boolean) => void;

const views = new Map<HTMLElement, SetAttached>();
let activeView: HTMLElement | null = null;

function isAfter(a: Node, b: Node) {
  return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

/** View nằm sau cùng trong DOM trong số các view còn đăng ký. */
function findLastView(): HTMLElement | null {
  let last: HTMLElement | null = null;
  views.forEach((_, el) => {
    if (last == null || isAfter(last, el)) last = el;
  });
  return last;
}

// Bật khi một view vừa mount đặt lại cuộn về đầu, tắt ở microtask kế tiếp.
// Dùng để nhận ra lần chạy effect thứ hai của StrictMode, khi window đã bị kéo về 0.
let resettingScroll = false;

function scrollWindowTo(x: number, y: number) {
  // 'instant': không để `scroll-behavior: smooth` của trang làm nội dung trôi
  window.scrollTo({ left: x, top: y, behavior: 'instant' });
}

const DetachedContext = createContext(false);

/** true khi màn hình chứa component này đang bị một màn hình khác che (vd: để dừng video). */
export function useIsDocumentScrollViewDetached() {
  return useContext(DetachedContext);
}

export interface DocumentScrollViewProps {
  children: ReactNode;
  /**
   * Nhớ vị trí cuộn theo key (vd: theo route). Đổi key -> cuộn về vị trí đã nhớ cho key đó
   * (nếu `maintainScrollForContext`) hoặc về đầu trang.
   */
  contextKey?: string;
  maintainScrollForContext?: boolean;
  /** View mới mount thì cuộn về đầu (modal mới mở luôn bắt đầu từ trên cùng). */
  resetScrollOnMount?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function DocumentScrollView({
  children,
  contextKey,
  maintainScrollForContext = false,
  resetScrollOnMount = true,
  className,
  style,
}: DocumentScrollViewProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [detached, setDetached] = useState(false);
  // vị trí cuộn lúc bị detach: dùng để vẽ (top/left âm) và để khôi phục khi attach lại
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const lastScrollRef = useRef({ x: 0, y: 0 });
  const savedByContextRef = useRef(new Map<string, { x: number; y: number }>());
  const wasDetachedRef = useRef<boolean | null>(null);
  const prevContextKeyRef = useRef(contextKey);

  // Đăng ký vào registry. Layout effect: phải xong trước khi trình duyệt vẽ frame đầu tiên.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (activeView == null || isAfter(activeView, el)) {
      // mình nằm sau view đang active -> mình lên làm active, view cũ bị detach
      if (activeView != null) views.get(activeView)?.(false);
      activeView = el;
    } else {
      setDetached(true);
    }
    views.set(el, (attached) => {
      if (!attached) {
        // Đọc vị trí THẬT ngay lúc bị detach: listener `scroll` chỉ chạy ở frame sau, nên nếu
        // trang vừa bị cuộn trong cùng frame (scrollIntoView, focus…) thì giá trị của nó đã cũ.
        // Ngoại lệ: view khác vừa kéo window về 0 trong task này (StrictMode chạy effect 2 lần),
        // khi đó giá trị đúng là giá trị đã lưu ở lần trước.
        if (!resettingScroll) lastScrollRef.current = { x: window.scrollX, y: window.scrollY };
        setOffset({ ...lastScrollRef.current });
      }
      setDetached(!attached);
    });
    return () => {
      views.delete(el);
      if (activeView === el) {
        activeView = findLastView();
        if (activeView != null) views.get(activeView)?.(true);
      }
    };
  }, []);

  // Vừa mount (đang attached) hoặc vừa được attach lại -> đặt vị trí cuộn của window.
  useLayoutEffect(() => {
    const wasDetached = wasDetachedRef.current;
    wasDetachedRef.current = detached;
    if (detached) return;
    if (wasDetached === null) {
      if (resetScrollOnMount) {
        scrollWindowTo(0, 0);
        resettingScroll = true;
        queueMicrotask(() => {
          resettingScroll = false;
        });
      }
    } else if (wasDetached) {
      scrollWindowTo(offset.x, offset.y);
    }
  }, [detached, offset, resetScrollOnMount]);

  // Đổi context (vd: chuyển route trong cùng màn hình): khôi phục vị trí đã nhớ hoặc lên đầu.
  useLayoutEffect(() => {
    if (prevContextKeyRef.current === contextKey) return;
    prevContextKeyRef.current = contextKey;
    const saved =
      maintainScrollForContext && contextKey != null
        ? savedByContextRef.current.get(contextKey)
        : undefined;
    const target = saved ?? { x: 0, y: 0 };
    if (detached) setOffset(target);
    else scrollWindowTo(target.x, target.y);
  }, [contextKey, maintainScrollForContext, detached]);

  // Chỉ view đang attached mới theo dõi vị trí cuộn của window.
  useEffect(() => {
    if (detached) return;
    const onScroll = () => {
      const position = { x: window.scrollX, y: window.scrollY };
      lastScrollRef.current = position;
      if (contextKey != null) savedByContextRef.current.set(contextKey, position);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [detached, contextKey]);

  const detachedStyle: CSSProperties | undefined = detached
    ? { position: 'fixed', top: -offset.y, left: -offset.x, width: '100%' }
    : undefined;

  return (
    <DetachedContext.Provider value={detached}>
      <div
        ref={ref}
        className={className}
        style={{ ...style, ...detachedStyle }}
        // màn hình bị che: trình đọc màn hình bỏ qua, Tab không đi vào được
        aria-hidden={detached || undefined}
        inert={detached}
        data-scroll-view={detached ? 'detached' : 'attached'}
      >
        {children}
      </div>
    </DetachedContext.Provider>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observeIntersection } from './observeIntersection';
import { defaultUserActivityMonitor, type UserActivityMonitor } from './userActivity';

/**
 * Đo xem một element thực sự được NHÌN THẤY bao lâu.
 * Lấy ý tưởng từ `useViewportDuration` của Facebook: "visible" không chỉ là nằm trong
 * viewport, mà tab còn phải đang mở và người dùng còn đang hoạt động.
 */

export type HiddenReason =
  | 'NOT_IN_VIEWPORT'
  | 'TAB_HIDDEN'
  | 'USER_INACTIVE'
  | 'TARGET_SIZE_0'
  | 'COMPONENT_UNMOUNTED'
  /** element/threshold/activityMonitor đổi giữa chừng: phiên đo cũ kết thúc, phiên mới bắt đầu */
  | 'OPTIONS_CHANGED'
  | 'PAGE_UNLOAD';

export interface VisibleEvent {
  visibleTime: number;
}

export interface HiddenEvent {
  visibleTime: number;
  hiddenTime: number;
  visibleDuration: number;
  hiddenReason: HiddenReason;
}

export interface UseViewportDurationOptions {
  /**
   * Tỉ lệ diện tích element phải nằm trong viewport, mặc định 0.5 (chuẩn impression quảng cáo).
   * Element quá cao không bao giờ đạt được tỉ lệ này, nên với nó ta tính "chiếm ≥ threshold
   * chiều cao viewport" (xem `isEntryVisible`).
   */
  threshold?: number;
  onVisible?: (event: VisibleEvent) => void;
  onHidden?: (event: HiddenEvent) => void;
  activityMonitor?: UserActivityMonitor | null;
}

// Mốc 0, 0.1, …, 1: observer báo lại mỗi khi tỉ lệ hiển thị đổi qua 10%,
// đủ mịn để biết element cao đang chiếm bao nhiêu viewport.
const THRESHOLD_STEPS = Array.from({ length: 11 }, (_, i) => i / 10);

export function isEntryVisible(entry: IntersectionObserverEntry, threshold: number): boolean {
  if (!entry.isIntersecting) return false;
  if (entry.intersectionRatio >= threshold) return true;
  // Element cao hơn viewport / threshold (vd: bài viết dài 2000px, viewport 700px) thì
  // intersectionRatio tối đa chỉ 0.35. Khi đó coi là "đang xem" nếu nó chiếm đủ
  // threshold chiều cao viewport (cùng ý với quy tắc "large ad" của IAB/MRC).
  const viewportHeight = entry.rootBounds?.height ?? window.innerHeight;
  return entry.intersectionRect.height >= viewportHeight * threshold;
}

export function useViewportDuration<T extends Element>({
  threshold = 0.5,
  onVisible,
  onHidden,
  activityMonitor = defaultUserActivityMonitor,
}: UseViewportDurationOptions) {
  const [node, setNode] = useState<T | null>(null);
  // visibleSince: mốc performance.now() (đơn điệu, không nhảy khi người dùng chỉnh đồng hồ)
  // để tính thời lượng; visibleAt: Date.now() để báo ra ngoài làm timestamp.
  const visibleSinceRef = useRef<number | null>(null);
  const visibleAtRef = useRef(0);
  const entryRef = useRef<IntersectionObserverEntry | null>(null);

  // Phân biệt "unmount" với "deps đổi": effect này khai báo TRƯỚC effect chính nên khi unmount,
  // cleanup của nó chạy trước và bật cờ; khi chỉ deps đổi thì nó không chạy cleanup.
  const unmountingRef = useRef(false);
  useEffect(() => {
    unmountingRef.current = false;
    return () => {
      unmountingRef.current = true;
    };
  }, []);

  // "latest ref": các subscription bên dưới chỉ tạo 1 lần nhưng luôn gọi callback mới nhất
  const callbacksRef = useRef({ onVisible, onHidden });
  useLayoutEffect(() => {
    callbacksRef.current = { onVisible, onHidden };
  });

  useEffect(() => {
    if (!node) return;
    entryRef.current = null;

    // Trả về lý do element đang bị coi là ẩn, hoặc null nếu đang thực sự được nhìn thấy.
    const getHiddenReason = (): HiddenReason | null => {
      const entry = entryRef.current;
      if (activityMonitor && !activityMonitor.isUserActive()) return 'USER_INACTIVE';
      if (document.visibilityState === 'hidden') return 'TAB_HIDDEN';
      if (!entry || !isEntryVisible(entry, threshold)) return 'NOT_IN_VIEWPORT';
      const { width, height } = entry.boundingClientRect;
      if (width === 0 || height === 0) return 'TARGET_SIZE_0';
      return null;
    };

    // Đánh giá lại trạng thái; `forcedReason` dùng khi ta biết chắc phải kết thúc (unmount, unload).
    const update = (forcedReason?: HiddenReason) => {
      const reason = forcedReason ?? getHiddenReason();
      const wasVisible = visibleSinceRef.current != null;

      if (!wasVisible && reason === null) {
        visibleSinceRef.current = performance.now();
        visibleAtRef.current = Date.now();
        callbacksRef.current.onVisible?.({ visibleTime: visibleAtRef.current });
      } else if (wasVisible && reason !== null) {
        const visibleDuration = Math.round(performance.now() - visibleSinceRef.current!);
        visibleSinceRef.current = null;
        callbacksRef.current.onHidden?.({
          visibleTime: visibleAtRef.current,
          hiddenTime: visibleAtRef.current + visibleDuration,
          visibleDuration,
          hiddenReason: reason,
        });
      }
    };

    const stopObserving = observeIntersection(
      node,
      (entry) => {
        entryRef.current = entry;
        update();
      },
      { threshold: [...new Set([...THRESHOLD_STEPS, threshold])] },
    );
    const onVisibilityChange = () => update();
    const onPageHide = () => update('PAGE_UNLOAD');
    // Trang được khôi phục từ bfcache (bấm Back): React không mount lại, effect không chạy
    // lại, nên phải tự bắt đầu đếm lại.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) update();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    const stopActivity = activityMonitor?.subscribe(() => update());

    return () => {
      update(unmountingRef.current ? 'COMPONENT_UNMOUNTED' : 'OPTIONS_CHANGED');
      stopObserving();
      stopActivity?.();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [node, threshold, activityMonitor]);

  return setNode;
}

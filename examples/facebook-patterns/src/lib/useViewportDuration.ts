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
  /** tỉ lệ diện tích phải nằm trong viewport, mặc định 0.5 (chuẩn impression quảng cáo) */
  threshold?: number;
  onVisible?: (event: VisibleEvent) => void;
  onHidden?: (event: HiddenEvent) => void;
  activityMonitor?: UserActivityMonitor | null;
}

export function useViewportDuration<T extends Element>({
  threshold = 0.5,
  onVisible,
  onHidden,
  activityMonitor = defaultUserActivityMonitor,
}: UseViewportDurationOptions) {
  const [node, setNode] = useState<T | null>(null);
  const visibleSinceRef = useRef<number | null>(null);
  const entryRef = useRef<IntersectionObserverEntry | null>(null);

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
      if (!entry || !entry.isIntersecting || entry.intersectionRatio < threshold) {
        return 'NOT_IN_VIEWPORT';
      }
      const { width, height } = entry.boundingClientRect;
      if (width === 0 || height === 0) return 'TARGET_SIZE_0';
      return null;
    };

    // Đánh giá lại trạng thái; `forcedReason` dùng khi ta biết chắc phải kết thúc (unmount, unload).
    const update = (forcedReason?: HiddenReason) => {
      const reason = forcedReason ?? getHiddenReason();
      const wasVisible = visibleSinceRef.current != null;
      const now = Date.now();

      if (!wasVisible && reason === null) {
        visibleSinceRef.current = now;
        callbacksRef.current.onVisible?.({ visibleTime: now });
      } else if (wasVisible && reason !== null) {
        const visibleTime = visibleSinceRef.current!;
        visibleSinceRef.current = null;
        callbacksRef.current.onHidden?.({
          visibleTime,
          hiddenTime: now,
          visibleDuration: now - visibleTime,
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
      // vài mốc threshold để intersectionRatio được cập nhật đủ mịn
      { threshold: [0, threshold, 1] },
    );
    const onVisibilityChange = () => update();
    const onPageHide = () => update('PAGE_UNLOAD');
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    const stopActivity = activityMonitor?.subscribe(() => update());

    return () => {
      update('COMPONENT_UNMOUNTED');
      stopObserving();
      stopActivity?.();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [node, threshold, activityMonitor]);

  return setNode;
}

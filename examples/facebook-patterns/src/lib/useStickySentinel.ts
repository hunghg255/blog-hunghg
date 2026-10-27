import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observeIntersection } from './observeIntersection';

/**
 * Biết khi nào một phần tử `position: sticky` đang "dính" mà không nghe sự kiện scroll
 * (theo BaseStickyHeader của Facebook):
 * - Đặt một sentinel rỗng (cao 0) NGAY TRƯỚC phần tử sticky.
 * - Quan sát sentinel với rootMargin top = -(top của sticky). Sentinel đi qua mép đó
 *   nghĩa là phần tử sticky đã chạm vị trí dính.
 */
export function useStickySentinel(
  onStickyChange: (stuck: boolean) => void,
  { topOffset = 0 }: { topOffset?: number } = {},
) {
  const [sentinel, setSentinel] = useState<HTMLElement | null>(null);
  const callbackRef = useRef(onStickyChange);
  useLayoutEffect(() => {
    callbackRef.current = onStickyChange;
  });

  useEffect(() => {
    if (!sentinel) return;
    let stuck: boolean | null = null;
    return observeIntersection(
      sentinel,
      (entry) => {
        // Facebook chỉ dùng "!isIntersecting". Thêm điều kiện sentinel nằm PHÍA TRÊN vùng
        // quan sát: nếu header còn ở dưới màn hình (chưa cuộn tới) thì cũng không intersect,
        // nhưng chắc chắn chưa "dính".
        const rootTop = entry.rootBounds?.top ?? topOffset;
        const next = !entry.isIntersecting && entry.boundingClientRect.top < rootTop;
        if (next === stuck) return;
        stuck = next;
        callbackRef.current(next);
      },
      { rootMargin: `${-topOffset}px 0px 0px 0px`, threshold: 0 },
    );
  }, [sentinel, topOffset]);

  return setSentinel;
}

/**
 * Bật/tắt class trực tiếp trên DOM trong requestAnimationFrame, KHÔNG re-render React
 * (giống imperative handle `setSticky` của CometEntityHeaderStickyBar).
 * Gọi liên tiếp trong cùng frame thì chỉ lần cuối có hiệu lực.
 */
export function useRafClassToggle<T extends HTMLElement>(className: string) {
  const ref = useRef<T>(null);
  const frame = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  const set = useCallback(
    (on: boolean) => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        ref.current?.classList.toggle(className, on);
      });
    },
    [className],
  );
  return [ref, set] as const;
}

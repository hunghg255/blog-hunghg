import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { observeIntersection, type ObserveIntersectionOptions } from './observeIntersection';

/**
 * Hook trả về [ref, inView]. Mọi component dùng cùng option sẽ chung một observer.
 */
export function useInView<T extends Element>(
  options: ObserveIntersectionOptions = {},
): [(node: T | null) => void, boolean] {
  const [node, setNode] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const { root, rootMargin, threshold } = options;
  // mảng threshold mới mỗi lần render -> so sánh bằng key để không đăng ký lại liên tục
  const thresholdKey = JSON.stringify(threshold ?? 0);

  useEffect(() => {
    if (!node) return;
    return observeIntersection(node, (entry) => setInView(entry.isIntersecting), {
      root,
      rootMargin,
      threshold: JSON.parse(thresholdKey),
    });
  }, [node, root, rootMargin, thresholdKey]);

  return [setNode, inView];
}

/**
 * Gọi `onLoadMore` khi phần tử "sentinel" ở cuối danh sách tiến gần viewport.
 * Giống CometInfiniteScrollSuspenseList: chặn gọi trùng cho tới khi danh sách thay đổi.
 */
export function useInfiniteScroll<T extends Element>({
  onLoadMore,
  hasMore,
  itemCount,
  rootMargin = '300px',
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  /** số item hiện tại, đổi giá trị = trang mới đã về -> cho phép trigger lần sau */
  itemCount: number;
  rootMargin?: string;
}) {
  const triggeredRef = useRef(false);
  // "latest ref": callback luôn là bản mới nhất mà không phải observe lại
  const onLoadMoreRef = useRef(onLoadMore);
  useLayoutEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  useEffect(() => {
    triggeredRef.current = false;
  }, [itemCount]);

  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node || !hasMore) return;
    return observeIntersection(
      node,
      (entry) => {
        if (!entry.isIntersecting || triggeredRef.current) return;
        triggeredRef.current = true;
        onLoadMoreRef.current();
      },
      { rootMargin },
    );
    // itemCount: observe lại sau mỗi trang để nếu sentinel vẫn còn trong viewport
    // (trang quá ngắn) thì nó bắn tiếp, không bị kẹt.
  }, [node, hasMore, rootMargin, itemCount]);

  return setNode;
}

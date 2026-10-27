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
 *
 * Giống CometInfiniteScrollSuspenseList: mỗi "phiên" observe chỉ được gọi tối đa một lần.
 * Khi đang tải thì ngừng observe. Tải xong (thành công hay lỗi) thì observe lại:
 * IntersectionObserver luôn bắn entry đầu tiên ngay khi bắt đầu observe, nên nếu sentinel
 * vẫn còn trong vùng kích hoạt (trang quá ngắn) thì trang tiếp theo được tải luôn.
 */
export function useInfiniteScroll<T extends Element>({
  onLoadMore,
  hasMore,
  isLoading,
  rootMargin = '300px',
}: {
  onLoadMore: () => void;
  hasMore: boolean;
  isLoading: boolean;
  rootMargin?: string;
}) {
  // "latest ref": callback luôn là bản mới nhất mà không phải observe lại
  const onLoadMoreRef = useRef(onLoadMore);
  useLayoutEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  });

  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node || !hasMore || isLoading) return;
    // Cờ riêng cho từng phiên observe: chặn trường hợp observer bắn 2 lần trước khi
    // React kịp render lại với isLoading = true.
    let fired = false;
    return observeIntersection(
      node,
      (entry) => {
        if (!entry.isIntersecting || fired) return;
        fired = true;
        onLoadMoreRef.current();
      },
      { rootMargin },
    );
  }, [node, hasMore, isLoading, rootMargin]);

  return setNode;
}

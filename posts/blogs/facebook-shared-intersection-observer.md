---
title: 'Học Từ Facebook #1: Dùng Chung Một IntersectionObserver Cho Hàng Trăm Element'
description: 'Cách Facebook dùng chung IntersectionObserver theo root + option, đếm tham chiếu để tự dọn dẹp, cô lập lỗi callback. Viết lại thành hook useInView và useInfiniteScroll, có demo.'
date: '2026-10-27T08:50'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-intersection-observer.png
tags: ['facebook', 'react', 'intersection-observer', 'performance', 'hooks']
---

Hầu như hook `useInView` nào bạn từng viết cũng giống thế này:

```tsx
useEffect(() => {
  const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting));
  observer.observe(ref.current);
  return () => observer.disconnect();
}, []);
```

Không sai, nhưng **mỗi component tạo một observer**. Một news feed có 200 bài viết, mỗi bài có ảnh lazy-load, video autoplay, tracking impression… sẽ có **hàng nghìn observer** chạy song song. Mỗi observer có vòng tính toán intersection riêng trong trình duyệt và tốn bộ nhớ riêng.

Facebook giải quyết chuyện này trong module `observeIntersection` (thư mục `useIntersectionObserver/` trong [facebook-codebase](https://github.com/hunghg255/facebook-codebase)).

## Facebook làm thế nào?

Đọc module này, có 4 ý chính:

1. **Gom theo `root`, rồi theo option.** Dùng `WeakMap<root, { [optionsKey]: SharedObserver }>`. Viewport không thể làm key của WeakMap (`root = null`), nên họ dùng một object hằng `{ __noRoot: true }` để đại diện.
2. **`optionsKey` được chuẩn hoá.** Threshold được bỏ trùng và sort, các key của object option cũng được sort trước khi `JSON.stringify`. Nhờ vậy `{ threshold: [1, 0.5] }` và `{ threshold: [0.5, 1, 1] }` dùng chung một observer.
3. **Một observer, nhiều callback.** Mỗi observer giữ `Map<element, callback[]>`. Khi entry về, nó tra map để gọi đúng callback của element đó.
4. **Đếm tham chiếu.** Callback cuối của element bị gỡ thì `unobserve`. Element cuối bị gỡ thì xoá observer khỏi cache. Mỗi callback còn được bọc trong `ErrorGuard` ([bài #6](/blogs/facebook-error-guard)) để một callback lỗi không chặn các callback khác.

API trả về `{ remove() }`, và `remove` gọi nhiều lần vẫn an toàn.

## Viết lại

Bản viết lại giữ nguyên 4 ý trên và sửa thêm một chỗ bản gốc chưa xử lý: khi element **đã** được observe và một callback thứ hai đăng ký sau, IntersectionObserver không bắn lại entry đầu tiên. Callback mới sẽ không biết element đang hiện hay không cho tới lần thay đổi kế tiếp. Ta lưu entry gần nhất và phát lại cho callback mới.

```ts title=src/lib/observeIntersection.ts
/**
 * Dùng chung IntersectionObserver giữa nhiều element.
 *
 * Ý tưởng lấy từ module `observeIntersection` của Facebook: các element có cùng
 * `root` + `rootMargin` + `threshold` sẽ dùng chung MỘT observer. Observer được
 * tạo khi có người cần và tự `disconnect()` khi không còn ai dùng.
 */

export type IntersectionCallback = (entry: IntersectionObserverEntry) => void;

export interface ObserveIntersectionOptions {
  root?: Element | Document | null;
  rootMargin?: string;
  threshold?: number | number[];
}

interface SharedObserver {
  observer: IntersectionObserver;
  callbacks: Map<Element, IntersectionCallback[]>;
  lastEntries: Map<Element, IntersectionObserverEntry>;
}

// WeakMap không cho dùng `null` làm key nên viewport được đại diện bằng một object rỗng.
const VIEWPORT_ROOT = {};
const observersByRoot = new WeakMap<object, Map<string, SharedObserver>>();

// Hai option giống nhau phải ra cùng một key: chuẩn hoá giá trị mặc định,
// sort + bỏ trùng threshold.
function getOptionsKey(rootMargin = '0px', threshold: number | number[] = 0): string {
  const normalizedThreshold = Array.isArray(threshold)
    ? [...new Set(threshold)].sort((a, b) => a - b)
    : [threshold];
  return JSON.stringify({ rootMargin, threshold: normalizedThreshold });
}

function reportCallbackError(error: unknown) {
  // Một callback lỗi không được làm hỏng các callback khác của cùng observer.
  // Ném lỗi ở task khác để vẫn hiện trên console / error tracking.
  setTimeout(() => {
    throw error;
  });
}

let observerCount = 0;
let targetCount = 0;

/** Số liệu để debug: đang có bao nhiêu observer và bao nhiêu element được theo dõi. */
export function getIntersectionStats() {
  return { observers: observerCount, targets: targetCount };
}

/**
 * Theo dõi `target`. Trả về hàm huỷ theo dõi (gọi nhiều lần cũng không sao).
 */
export function observeIntersection(
  target: Element,
  callback: IntersectionCallback,
  options: ObserveIntersectionOptions = {},
): () => void {
  const rootKey = options.root ?? VIEWPORT_ROOT;
  const optionsKey = getOptionsKey(options.rootMargin, options.threshold);

  let observersForRoot = observersByRoot.get(rootKey);
  if (!observersForRoot) {
    observersForRoot = new Map();
    observersByRoot.set(rootKey, observersForRoot);
  }

  let shared = observersForRoot.get(optionsKey);
  if (!shared) {
    const callbacks = new Map<Element, IntersectionCallback[]>();
    const lastEntries = new Map<Element, IntersectionObserverEntry>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          lastEntries.set(entry.target, entry);
          // copy mảng: callback có thể tự huỷ đăng ký trong lúc đang chạy
          for (const cb of callbacks.get(entry.target)?.slice() ?? []) {
            try {
              cb(entry);
            } catch (error) {
              reportCallbackError(error);
            }
          }
        }
      },
      {
        root: options.root ?? null,
        rootMargin: options.rootMargin,
        threshold: options.threshold,
      },
    );
    shared = { observer, callbacks, lastEntries };
    observersForRoot.set(optionsKey, shared);
    observerCount++;
  }

  const current = shared;
  let removed = false;
  let callbacksForTarget = current.callbacks.get(target);
  if (!callbacksForTarget) {
    callbacksForTarget = [];
    current.callbacks.set(target, callbacksForTarget);
    current.observer.observe(target);
    targetCount++;
  } else {
    // Element đã được observe trước đó nên observer sẽ không bắn entry đầu tiên
    // cho callback mới. Phát lại entry gần nhất để callback mới cũng biết trạng thái.
    const last = current.lastEntries.get(target);
    if (last) {
      queueMicrotask(() => {
        if (!removed) callback(last);
      });
    }
  }
  callbacksForTarget.push(callback);

  return () => {
    if (removed) return;
    removed = true;

    const list = current.callbacks.get(target);
    if (!list) return;
    const index = list.indexOf(callback);
    if (index !== -1) list.splice(index, 1);

    if (list.length === 0) {
      current.callbacks.delete(target);
      current.lastEntries.delete(target);
      current.observer.unobserve(target);
      targetCount--;
    }

    if (current.callbacks.size === 0) {
      current.observer.disconnect();
      observersForRoot!.delete(optionsKey);
      observerCount--;
      if (observersForRoot!.size === 0) observersByRoot.delete(rootKey);
    }
  };
}
```

Một vài chi tiết đáng chú ý:

- `callbacks.get(entry.target)?.slice()`: copy mảng trước khi lặp, vì callback có thể tự huỷ đăng ký ngay trong lúc chạy (ví dụ "hiện một lần rồi thôi").
- `reportCallbackError` ném lỗi trong `setTimeout`: lỗi vẫn hiện trên console và Sentry, nhưng không làm vòng lặp dừng giữa chừng.
- `getIntersectionStats()` chỉ để debug. Demo bên dưới dùng nó để đếm observer.

## Hook `useInView`

```ts title=src/lib/useInView.ts
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
```

Dùng `useState` cho element (callback ref) thay vì `useRef`. Khi element đổi (điều kiện render, `key` thay đổi), effect chạy lại và observe element mới. Với `useRef`, effect không biết `ref.current` đã đổi.

## Demo

300 card, mỗi card một `useInView`. Bật/tắt công tắc để so sánh: dùng chung chỉ cần **1** observer, cách thông thường cần **300**.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/shared-intersection-observer" title="Demo shared-intersection-observer" loading="lazy" style="height: 560px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/shared-intersection-observer" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/observeIntersection.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/observeIntersection.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Ứng dụng: infinite scroll

Phiên bản infinite scroll của Facebook (`CometInfiniteScrollSuspenseList`) cũng dựa trên observer: đặt một `div` rỗng (sentinel) ở cuối danh sách, sentinel tiến gần viewport thì tải trang tiếp. Có hai chi tiết nhỏ nhưng quan trọng:

- Một ref `alreadyTriggered` để **không gọi `onLoadMore` hai lần** khi sentinel bắn liên tục trong lúc chờ API.
- `rootMargin` dương để tải **trước** khi người dùng chạm đáy.

```ts title=src/lib/useInView.ts
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
```

Chỗ dễ sai: nếu trang đầu quá ngắn, sentinel vẫn nằm trong viewport sau khi tải xong. Observer chỉ bắn khi trạng thái **thay đổi**, nên sẽ không có lần bắn tiếp theo và danh sách bị "kẹt". Đưa `itemCount` vào dependency để observe lại sau mỗi trang giải quyết được chuyện này: observe lại thì observer bắn entry đầu tiên.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/infinite-scroll" title="Demo infinite-scroll" loading="lazy" style="height: 480px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/infinite-scroll" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/observeIntersection.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/observeIntersection.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Khi nào nên dùng?

- **Nên**: feed, grid ảnh, bảng dài, bất cứ đâu có từ vài chục element dùng observer với **cùng option**.
- **Không cần**: trang chỉ có vài observer. Khi đó code đơn giản quan trọng hơn.
- Nếu dùng thư viện như `react-intersection-observer`, nó cũng đã dùng chung observer theo option. Giờ bạn hiểu nó làm gì bên trong.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- **#1 Dùng chung IntersectionObserver + infinite scroll** (bài này)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

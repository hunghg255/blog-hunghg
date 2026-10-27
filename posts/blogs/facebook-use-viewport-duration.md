---
title: 'Học Từ Facebook #2: useViewportDuration, Đo Đúng Thời Gian Người Dùng Thực Sự Xem'
description: 'isIntersecting chưa có nghĩa là người dùng đang xem. Cách Facebook đo impression: kết hợp viewport, tab ẩn, người dùng không hoạt động, unmount và unload, kèm lý do ẩn. Viết lại bằng React + TS có demo.'
date: '2026-10-27T08:40'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-viewport-duration.png
tags: ['facebook', 'react', 'analytics', 'intersection-observer', 'hooks']
---

Bạn cần đếm **impression** (một bài viết hoặc quảng cáo đã được xem) hay **thời gian xem** của từng item trong feed. Cách đầu tiên ai cũng nghĩ tới là IntersectionObserver: `isIntersecting` thì bấm giờ, hết intersect thì dừng.

Con số đó sẽ sai, vì những trường hợp sau đều bị tính là "đang xem":

- Người dùng mở feed rồi **chuyển sang tab khác** 30 phút.
- Người dùng **bỏ máy đi pha cà phê**, màn hình vẫn sáng.
- Element đang ở `opacity: 0` hoặc kích thước 0 (chưa load xong, đang animate).
- Component **unmount** hoặc **trang đóng** mà không có event "ẩn" nào được gửi. Lượt xem đó mất hẳn.

Hook `useViewportDuration` của Facebook (thư mục `useViewportDuration/` và `Scroll/` trong [facebook-codebase](https://github.com/hunghg255/facebook-codebase)) xử lý tất cả các trường hợp trên.

## Facebook làm thế nào?

Ý chính là: **"visible" là kết quả của nhiều điều kiện**, và mỗi lần chuyển sang "hidden" phải có **lý do**. Hàm kiểm tra của họ trả về lý do đầu tiên khiến element bị coi là ẩn:

| Lý do | Khi nào |
| --- | --- |
| `USER_INACTIVE` | không có input một thời gian (`CometVisibilityUserActivityMonitor`) |
| `PUSH_VIEW_HIDDEN` / `BACKGROUNDED` | màn hình bị che bởi view khác / tab chạy nền |
| `NOT_IN_VIEWPORT` | ra khỏi viewport |
| `TARGET_SIZE_0` | element có width hoặc height = 0 |
| `TARGET_TRANSPARENT` / `TARGET_HIDDEN` | `opacity: 0` / `visibility: hidden` |
| `COMPONENT_UNMOUNTED` / `PAGE_UNLOAD` | component unmount / trang đóng |

Mỗi lần ẩn, callback `onHidden` nhận `{ visibleTime, hiddenTime, visibleDuration, hiddenReason }`. Đội data có thể lọc theo lý do: impression kết thúc vì `PAGE_UNLOAD` khác hẳn impression kết thúc vì người dùng cuộn qua.

Một kỹ thuật nhỏ cũng đáng học: callback được giữ trong một ref (`B.current = A` trong `useLayoutEffect`). Subscription chỉ tạo **một lần**, nhưng luôn gọi callback mới nhất. Người dùng hook có thể truyền arrow function inline mà không làm observer bị tạo lại mỗi lần render.

## Viết lại

Trước tiên là một "activity monitor": người dùng không có thao tác nào trong `inactiveAfterMs` thì coi là inactive. Listener chỉ được gắn khi có người subscribe.

```ts title=src/lib/userActivity.ts
/**
 * Theo dõi người dùng còn "hoạt động" hay không (giống CometVisibilityUserActivityMonitor).
 * Không có input (chuột, phím, cuộn, chạm) trong `inactiveAfterMs` -> inactive.
 * Chỉ gắn event listener khi có người subscribe.
 */

export interface UserActivityMonitor {
  isUserActive(): boolean;
  subscribe(listener: (active: boolean) => void): () => void;
}

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart'];

export function createUserActivityMonitor(inactiveAfterMs = 10_000): UserActivityMonitor {
  const listeners = new Set<(active: boolean) => void>();
  let active = true;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const setActive = (next: boolean) => {
    if (active === next) return;
    active = next;
    listeners.forEach((listener) => listener(active));
  };

  const onActivity = () => {
    setActive(true);
    clearTimeout(timer);
    timer = setTimeout(() => setActive(false), inactiveAfterMs);
  };

  const start = () => {
    ACTIVITY_EVENTS.forEach((type) =>
      window.addEventListener(type, onActivity, { capture: true, passive: true }),
    );
    onActivity();
  };

  const stop = () => {
    ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, true));
    clearTimeout(timer);
    active = true;
  };

  return {
    isUserActive: () => active,
    subscribe(listener) {
      if (listeners.size === 0) start();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
  };
}

export const defaultUserActivityMonitor = createUserActivityMonitor();
```

Hook chính dùng `observeIntersection` từ [bài #1](/blogs/facebook-shared-intersection-observer), nên 200 bài viết trong feed vẫn chỉ cần một observer:

```ts title=src/lib/useViewportDuration.ts
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
```

Đáng chú ý:

- **`update()` là nơi duy nhất quyết định trạng thái.** Mọi nguồn sự kiện (intersection, `visibilitychange`, activity, `pagehide`, unmount) đều chỉ gọi `update()`. Không có nhánh logic riêng cho từng event nên khó sai.
- **Threshold mặc định 0.5**: theo chuẩn IAB/MRC, quảng cáo hiển thị được tính khi ≥ 50% diện tích nằm trong viewport (≥ 1 giây với display).
- **Dùng `pagehide` thay cho `unload`**: `unload` không chạy ổn định trên mobile và làm trang mất bfcache.

## Demo

Cuộn feed, chuyển tab, hoặc **để yên chuột 5 giây** (demo đặt inactive sau 5 giây) rồi xem log bên phải.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/viewport-duration" title="Demo viewport-duration" loading="lazy" style="height: 620px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/viewport-duration" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/useViewportDuration.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/useViewportDuration.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Dùng trong dự án

Kết hợp với batch logger ở [bài #7](/blogs/facebook-batch-logger) là có hệ thống impression tracking khá hoàn chỉnh:

```tsx
function FeedStory({ story }: { story: Story }) {
  const ref = useViewportDuration<HTMLElement>({
    onHidden: ({ visibleDuration, hiddenReason }) => {
      // dưới 300ms thường là cuộn lướt qua, không tính
      if (visibleDuration < 300) return;
      logger.log('story_vpv', { id: story.id, ms: visibleDuration, reason: hiddenReason });
    },
  });
  return <article ref={ref}>…</article>;
}
```

> [!TIP]
> Khi gửi log lúc `PAGE_UNLOAD`, phải dùng `navigator.sendBeacon` (hoặc `fetch` với `keepalive: true`). Request thường bị huỷ khi trang đóng. Bài #7 nói kỹ về chuyện này.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- **#2 useViewportDuration: đo thời gian thực sự được xem** (bài này)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

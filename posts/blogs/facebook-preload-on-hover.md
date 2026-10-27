---
title: 'Học Từ Facebook #3: Preload Code Và Data Ngay Khi Người Dùng Hover'
description: 'Người dùng hover khoảng 200-300ms trước khi click. Facebook tận dụng khoảng thời gian đó để tải trước JS chunk và data. Viết lại lazyWithPreload, createResource, usePreloadOnHover, và cái bẫy 300ms của Suspense.'
date: '2026-10-27T08:30'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-preload.png
tags: ['facebook', 'react', 'performance', 'suspense', 'code-splitting']
---

Bạn đã code-split dialog "Xem profile" bằng `React.lazy` để bundle ban đầu nhẹ hơn. Kết quả là mỗi lần bấm nút, người dùng phải chờ **tải chunk JS rồi mới gọi API**, nhìn spinner gần một giây.

Facebook xử lý chuyện này rất gọn. Từ lúc con trỏ chạm vào nút tới lúc click thường có **khoảng 200–300ms**. Nếu bắt đầu tải ngay khi hover, phần lớn thời gian chờ đã trôi qua trước cả khi người dùng click.

## Facebook làm thế nào?

Trong thư mục `Prerenderer/` của [facebook-codebase](https://github.com/hunghg255/facebook-codebase) có `useCometPreloaderImpl` và `useCometPrerendererImpl`. Đọc kỹ thì thấy:

- **Chỉ hover bằng chuột mới tính.** Handler kiểm tra `event.pointerType === "mouse"`. Trên cảm ứng không có hover, nên họ preload ở `pointerdown`, sớm hơn `click` một nhịp.
- **Chờ 50ms rồi mới preload.** Lướt chuột ngang qua nút không tốn request. Rời chuột trước 50ms thì huỷ timer.
- **Nhiều mức độ.** `"tooltip"` preload và prerender khi hover. `"button"` preload khi hover, prerender khi nhấn xuống. `"button_aggressive"` preload luôn khi **chuột dừng lại** trên nút (`CometMouseActivity.addOnMouseStopCallback`).
- **Preload hai thứ**: code (`JSResource`, tương đương `import()`) và data (query của Relay).
- Ngoài ra họ còn **prerender**: render sẵn component vào cây ẩn, tới lúc mở thì chỉ cần hiện ra.

## Viết lại

Ba thứ cần có:

1. `lazyWithPreload`: `React.lazy` kèm hàm `preload()` dùng chung một promise.
2. `createResource`: cache promise data theo key, dùng được với `use()` của React 19.
3. `usePreloadOnHover`: trả về các event handler để gắn vào nút.

```ts title=src/lib/preload.ts
import {
  createElement,
  lazy,
  useCallback,
  useEffect,
  useRef,
  type ComponentProps,
  type ComponentType,
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
}

/**
 * Trả về các event handler để gắn vào nút/link.
 * - Chuột: hover đủ `delay` ms mới preload, rời chuột trước đó thì huỷ.
 * - Cảm ứng: không có hover -> preload ngay khi ngón tay chạm xuống (trước click ~100ms).
 * - Bàn phím: preload khi focus.
 */
export function usePreloadOnHover(preload: () => void, { delay = 50 }: UsePreloadOnHoverOptions = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const preloadRef = useRef(preload);
  useEffect(() => {
    preloadRef.current = preload;
  });

  const cancel = useCallback(() => {
    if (timerRef.current != null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const onPointerEnter = useCallback(
    (event: React.PointerEvent) => {
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
  }, [cancel]);

  const onFocus = useCallback(() => preloadRef.current(), []);

  return { onPointerEnter, onPointerLeave: cancel, onPointerDown, onFocus };
}
```

### Cái bẫy 300ms của Suspense

Bản đầu tiên của mình chỉ là `Object.assign(lazy(load), { preload: load })`. Demo đo được: preload xong xuôi mà vẫn **chờ đúng 300ms** sau khi click. Vì sao?

- `React.lazy` **luôn suspend ở lần render đầu**, kể cả khi promise đã resolve. Nó chỉ biết kết quả sau khi tự `.then()` vào promise.
- `use(promise)` cũng vậy nếu promise không có field `status`.
- Khi một Suspense boundary đã hiện fallback, React **throttle việc hiện lại nội dung** (`FALLBACK_THROTTLE_MS`: 300ms ở React 19, 500ms ở React 18) để UI không nháy liên tục.

Cách sửa nằm trong code ở trên:

- `lazyWithPreload` lưu module đã tải vào biến `loaded`. Có rồi thì `createElement(loaded)` trực tiếp, không đi qua `lazy`.
- `createResource` gắn `status = 'fulfilled'` và `value` lên promise. `use()` đọc hai field này. Thấy promise đã xong, nó trả về giá trị **đồng bộ** thay vì suspend.

Sau khi sửa, thời gian từ click tới lúc hiện nội dung (đã preload) giảm từ ~300ms xuống ~1ms.

## Demo

Dialog cần 1 chunk JS (giả lập 600ms) và 1 API (700ms). Cả hai nút đều tải code và data **song song** khi click. Nút thứ hai bắt đầu sớm hơn từ lúc hover. Rê chuột lên nút chừng nửa giây rồi mới bấm.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/preload-on-hover" title="Demo preload-on-hover" loading="lazy" style="height: 560px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/preload-on-hover" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/preload.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/preload.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Dùng trong dự án

Với Next.js App Router, `<Link>` đã tự prefetch route khi link xuất hiện trong viewport. Kỹ thuật này hữu ích nhất cho:

- **Dialog, drawer, popover nặng** (editor, picker, bảng chọn emoji…) đã tách chunk.
- **Data cho trang chi tiết**: hover vào một item trong list thì gọi `queryClient.prefetchQuery(...)` (React Query) với đúng query key mà trang chi tiết sẽ dùng.

```tsx
const handlers = usePreloadOnHover(() => {
  void EmojiPicker.preload();
  queryClient.prefetchQuery({ queryKey: ['user', id], queryFn: () => getUser(id) });
});

<button {...handlers} onClick={open}>😀</button>;
```

> [!NOTE]
> Đừng preload thứ quá nặng (video, file lớn) chỉ vì hover. Hover không đồng nghĩa với chắc chắn click. Preload hợp nhất với thứ nhỏ, cache được và gần như chắc chắn sẽ dùng.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- **#3 Preload code + data khi hover** (bài này)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

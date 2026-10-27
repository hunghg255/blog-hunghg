---
title: 'Học Từ Facebook #4: Toast Manager Với External Store, Hàng Đợi Và Dừng Khi Hover'
description: 'Phân tích CometToasterStateManager của Facebook: store không phụ thuộc React, vòng đời push → shown → expired → deleted, giới hạn hàng đợi, đếm giờ chỉ khi đã hiện. Viết lại với useSyncExternalStore, có demo.'
date: '2026-10-27T08:20'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-toast.png
tags: ['facebook', 'react', 'state-management', 'useSyncExternalStore', 'ui']
---

Toast ("Đã lưu bài viết", "Đã sao chép liên kết") trông đơn giản, nhưng làm cho đúng thì có kha khá câu hỏi:

- Gọi `toast()` từ **ngoài React** thế nào (trong hàm gọi API, trong service worker message handler…)?
- 10 toast bắn liên tiếp thì hiện cả 10 chồng lên nhau à?
- Toast tự tắt sau 4 giây, nhưng nếu người dùng **đang đọc** (hover) thì sao?
- Toast đang chờ trong hàng đợi thì đồng hồ có chạy không?

Facebook trả lời các câu hỏi này trong `CometToasterStateManager` (thư mục `Toaster/` của [facebook-codebase](https://github.com/hunghg255/facebook-codebase)).

## Facebook làm thế nào?

**1. Store là class thuần, không dính tới React.** Nó là một singleton (`getInstance()`) với các method `push`, `shown`, `expire`, `hidden`, `delete`, `stopTimer`, `resetTimer`, `addListener`, `getState`. Bên trong, mọi method đều chuyển thành **action** (`{ type: 'PUSH' }`, `{ type: 'SHOWN' }`…) và đi qua một hàm giống reducer. Mỗi lần đổi, state là một **`Map` mới** (immutable), nên view chỉ cần so sánh tham chiếu.

**2. Vòng đời một toast:**

```text
PUSH ──▶ (chờ trong hàng đợi) ──▶ SHOWN ──▶ EXPIRE ──▶ (1s animation) ──▶ DELETE
                                   │  ▲
                        STOP_TIMER │  │ RESET_TIMER (hover vào / rời ra)
```

**3. Chỉ đếm giờ khi đã hiện.** Timer chỉ bắt đầu ở `SHOWN`, khi view báo toast đã thực sự lên màn hình. Toast nằm chờ phía sau không bị "hết hạn" trước khi kịp hiện ra.

**4. Giới hạn hàng đợi.** Config `CometMaxEnqueuedToastsSitevarConfig.max = 2`: số toast **chưa hiện** vượt 2 thì toast cũ nhất bị xoá. 10 thông báo "đã lưu" liên tiếp không cần hiện đủ cả 10.

**5. Hết hạn trước, xoá sau.** `EXPIRE` chỉ gắn cờ `expired`. Một giây sau mới `DELETE`, để view có thời gian chạy animation thoát.

**6. Nhiều view, một store.** `registerView(handler, priority)` cho phép nhiều nơi cùng render toast (trang chính, trang chat pop-out…). Chỉ view có priority cao nhất nhận state, các view còn lại nhận state rỗng.

## Viết lại

Bản viết lại giữ ý 1–5 và dùng `useSyncExternalStore`, API chính thức của React để "cắm" một external store vào component:

```ts title=src/lib/toaster.ts
import { useSyncExternalStore } from 'react';

/**
 * Store quản lý toast, không phụ thuộc React (lấy ý tưởng từ CometToasterStateManager).
 *
 * Vòng đời một toast:
 *   push -> (chờ trong hàng đợi) -> shown (bắt đầu đếm giờ) -> expired (chạy animation thoát)
 *        -> bị xoá khỏi store sau `exitDuration`.
 * Hover vào toast thì dừng đồng hồ, rời chuột thì đếm lại từ đầu.
 */

export interface Toast<T> {
  id: string;
  value: T;
  /** null = không tự tắt */
  duration: number | null;
  shown: boolean;
  expired: boolean;
  /** tăng mỗi lần đồng hồ chạy lại, view dùng làm key để reset thanh progress */
  timerVersion: number;
  paused: boolean;
}

export interface ToastStoreOptions {
  /** số toast tối đa CHƯA hiển thị được giữ trong hàng đợi; vượt quá thì bỏ cái cũ nhất */
  maxQueued?: number;
  exitDuration?: number;
}

export class ToastStore<T> {
  private nextId = 0;
  private toasts: readonly Toast<T>[] = [];
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();
  private maxQueued: number;
  private exitDuration: number;

  constructor({ maxQueued = 2, exitDuration = 300 }: ToastStoreOptions = {}) {
    this.maxQueued = maxQueued;
    this.exitDuration = exitDuration;
  }

  // --- API cho nơi phát toast ---

  push(value: T, duration: number | null = 4000): string {
    const id = `toast-${this.nextId++}`;
    let next = [
      ...this.toasts,
      { id, value, duration, shown: false, expired: false, timerVersion: 0, paused: false },
    ];
    const queued = next.filter((t) => !t.shown && !t.expired);
    if (this.maxQueued > 0 && queued.length > this.maxQueued) {
      // Spam 10 toast liên tiếp thì người dùng không cần xem hết: bỏ cái cũ nhất đang chờ.
      next = next.filter((t) => t.id !== queued[0].id);
    }
    this.setToasts(next);
    return id;
  }

  dismiss(id: string) {
    const toast = this.get(id);
    if (!toast || toast.expired) return;
    this.clearTimer(id);
    this.update(id, { expired: true });
    // giữ lại thêm một chút cho animation thoát rồi mới xoá hẳn
    setTimeout(() => this.setToasts(this.toasts.filter((t) => t.id !== id)), this.exitDuration);
  }

  // --- API cho view ---

  /** View báo toast đã thực sự hiện trên màn hình -> lúc này mới bắt đầu đếm giờ. */
  markShown(id: string) {
    const toast = this.get(id);
    if (!toast || toast.shown) return;
    this.update(id, { shown: true });
    this.startTimer(id);
  }

  pause(id: string) {
    const toast = this.get(id);
    if (!toast || toast.expired || toast.paused) return;
    this.clearTimer(id);
    this.update(id, { paused: true });
  }

  resume(id: string) {
    const toast = this.get(id);
    if (!toast || toast.expired || !toast.paused) return;
    this.update(id, { paused: false, timerVersion: toast.timerVersion + 1 });
    this.startTimer(id);
  }

  // --- external store cho useSyncExternalStore ---

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.toasts;

  // --- nội bộ ---

  private get(id: string) {
    return this.toasts.find((t) => t.id === id);
  }

  private update(id: string, patch: Partial<Toast<T>>) {
    this.setToasts(this.toasts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  private setToasts(next: readonly Toast<T>[]) {
    // luôn tạo mảng mới (immutable) để useSyncExternalStore nhận ra thay đổi
    this.toasts = next;
    this.listeners.forEach((listener) => listener());
  }

  private startTimer(id: string) {
    const toast = this.get(id);
    if (!toast || toast.duration == null) return;
    this.clearTimer(id);
    this.timers.set(
      id,
      setTimeout(() => this.dismiss(id), toast.duration),
    );
  }

  private clearTimer(id: string) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }
}

export function useToasts<T>(store: ToastStore<T>) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
```

Thêm hai field cho view:

- `paused`: để dừng thanh progress bằng `animation-play-state: paused`.
- `timerVersion`: tăng mỗi khi đồng hồ chạy lại từ đầu. View dùng nó làm `key` cho thanh progress để animation CSS cũng chạy lại từ đầu.

View chỉ còn khoảng 40 dòng:

```tsx title=src/demos/ToastDemo.tsx
import { useEffect, useMemo, useState } from 'react';
import { ToastStore, useToasts, type Toast } from '../lib/toaster';
import { Stat } from './shared';

function Toaster({ store, maxVisible }: { store: ToastStore<string>; maxVisible: number }) {
  const toasts = useToasts(store);
  // Hiện tối đa maxVisible toast, phần còn lại nằm chờ trong store.
  const visible = toasts.slice(0, maxVisible);

  useEffect(() => {
    // báo cho store biết toast nào đã lên màn hình -> store mới bắt đầu đếm giờ
    visible.forEach((t) => !t.shown && store.markShown(t.id));
  }, [visible, store]);

  return (
    <ul className='toaster'>
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} store={store} />
      ))}
    </ul>
  );
}

function ToastItem({ toast, store }: { toast: Toast<string>; store: ToastStore<string> }) {
  return (
    <li
      className={`toast${toast.expired ? ' expired' : ''}`}
      role='status'
      onPointerEnter={() => store.pause(toast.id)}
      onPointerLeave={() => store.resume(toast.id)}
    >
      <span>{toast.value}</span>
      <button aria-label='Đóng' onClick={() => store.dismiss(toast.id)}>
        ✕
      </button>
      {toast.duration != null && toast.shown && (
        <div
          key={toast.timerVersion}
          className='toast-progress'
          style={{
            animationDuration: `${toast.duration}ms`,
            animationPlayState: toast.paused ? 'paused' : 'running',
          }}
        />
      )}
    </li>
  );
}
```

## Demo

Bấm **Spam 10 toast**: 3 toast đầu hiện ra, hàng đợi giữ tối đa 2 toast, các toast ở giữa bị bỏ. Hover vào một toast để giữ nó lại.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/toaster" title="Demo toaster" loading="lazy" style="height: 440px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/toaster" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/toaster.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/toaster.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Dùng trong dự án

Tạo một store dùng chung cho cả app và gọi từ bất cứ đâu:

```ts title=toast.ts
export const toastStore = new ToastStore<{ message: string; tone?: 'error' }>();

export const toast = {
  success: (message: string) => toastStore.push({ message }),
  error: (message: string) => toastStore.push({ message, tone: 'error' }, 8000),
};
```

```ts
// trong một hàm gọi API, không cần hook hay context
try {
  await savePost(post);
  toast.success('Đã lưu bài viết');
} catch {
  toast.error('Lưu thất bại, thử lại sau');
}
```

> [!TIP]
> Đây cũng là ý tưởng phía sau [sonner](https://sonner.emilkowal.ski) và `react-hot-toast`: state toast nằm trong một store ở module scope, component `<Toaster />` chỉ subscribe để render. Hiểu pattern này thì bạn tự viết được store cho modal, command palette, notification center…

Đừng quên accessibility: thêm `role="status"` (hoặc `aria-live="polite"`) để trình đọc màn hình đọc toast. Với toast lỗi quan trọng thì dùng `role="alert"`.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- **#4 Toast manager với external store** (bài này)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

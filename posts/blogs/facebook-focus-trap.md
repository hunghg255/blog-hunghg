---
title: 'Học Từ Facebook #8: Focus Trap Và Esc Theo Layer Cho Dialog Chuẩn Accessibility'
description: 'Cách Facebook giữ focus trong dialog (FocusRegion, getTabbableNodes), trả focus khi đóng, và chỉ đóng layer trên cùng khi bấm Esc (CometHideLayerOnEscape). Viết lại useFocusTrap và useEscapeLayer, có demo dialog lồng nhau.'
date: '2026-10-27T07:40'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-focus-trap.png
tags: ['facebook', 'react', 'accessibility', 'a11y', 'dialog']
---

Dialog tự viết thường làm đúng phần nhìn thấy (nền mờ, nút đóng) nhưng sai phần **bàn phím**:

- Bấm Tab, focus **chạy ra các nút phía sau** lớp nền mờ.
- Đóng dialog, focus **rơi về `<body>`**. Người dùng bàn phím và trình đọc màn hình phải Tab lại từ đầu trang.
- Dialog lồng nhau (dialog xác nhận mở trên dialog sửa), bấm Esc thì **cả hai cùng đóng**.

Facebook có cả một hệ thống cho việc này: `FocusRegion`, `FocusManager`, `getTabbableNodes`, `focusScopeQueries` (thư mục `FocusRegion/`) và `CometHideLayerOnEscape`, `CometKeyCommandContext` (thư mục `CommetKeyCommands/`) trong [facebook-codebase](https://github.com/hunghg255/facebook-codebase).

## Facebook làm thế nào?

**1. `getTabbableNodes`** lấy danh sách node Tab tới được trong vùng, rồi lọc thêm: `offsetWidth > 0 && offsetHeight > 0`, `tabIndex !== -1`, `visibility !== "hidden"`. Element hiện tại đang focus luôn được giữ lại. Hàm trả về `[nodes, first, last, currentIndex, current]`, đủ để tính "Tab tiếp theo đi đâu".

**2. `FocusRegion`** là component bao một vùng với các tuỳ chọn: `containFocusQuery` (giữ focus trong vùng), `autoFocusQuery` (focus phần tử đầu khi mount), `recoverFocusQuery` (kéo focus lại khi lọt ra ngoài), `autoRestoreFocus` (trả focus về chỗ cũ khi unmount).

**3. Esc theo layer.** Mỗi layer (dialog, popover, menu) đăng ký phím tắt vào context của riêng nó. `CometHideLayerOnEscape` chỉ xử lý Esc cho layer **trên cùng**. Layer bên dưới không nhận được.

## Viết lại

```ts title=src/lib/focusTrap.ts
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/**
 * Giữ focus trong dialog + khôi phục focus khi đóng (ý tưởng từ FocusRegion / getTabbableNodes)
 * và đóng đúng layer trên cùng khi bấm Esc (ý tưởng từ CometHideLayerOnEscape).
 */

const TABBABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  'summary',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',');

/** Các element Tab tới được, theo đúng thứ tự trong DOM. */
export function getTabbableNodes(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter((el) => {
    if (el.tabIndex < 0) return false;
    // bị ẩn bằng display:none / kích thước 0 / visibility:hidden thì không focus được
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && el.getClientRects().length === 0) {
      return false;
    }
    return getComputedStyle(el).visibility !== 'hidden';
  });
}

export interface UseFocusTrapOptions {
  /** focus vào phần tử đầu tiên khi mở, mặc định true */
  autoFocus?: boolean;
  /** trả focus về nơi mở dialog khi đóng, mặc định true */
  restoreFocus?: boolean;
}

export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  { autoFocus = true, restoreFocus = true }: UseFocusTrapOptions = {},
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;

    if (autoFocus && !container.contains(document.activeElement)) {
      // không có gì focus được thì focus chính container (cần tabIndex=-1)
      (getTabbableNodes(container)[0] ?? container).focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      // dialog lồng nhau: chỉ dialog chứa element đang focus mới xử lý
      if (!container.contains(document.activeElement)) return;
      const nodes = getTabbableNodes(container);
      if (nodes.length === 0) {
        event.preventDefault();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || current === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // Focus lọt ra ngoài (click ra nền, công cụ trợ năng…) thì kéo lại vào trong.
    // Bỏ qua nếu focus đi vào một dialog khác mở chồng lên trên.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node;
      if (container.contains(target)) return;
      if (target instanceof Element && target.closest('[data-focus-trap]')) return;
      (getTabbableNodes(container)[0] ?? container).focus();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
      // chỉ trả focus nếu element cũ vẫn còn trên trang
      if (restoreFocus && previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [active, autoFocus, restoreFocus, containerRef]);
}

// ---- Esc chỉ đóng layer trên cùng ----

const escapeStack: Array<{ current: () => void }> = [];
let escapeListenerInstalled = false;

function onEscapeKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || escapeStack.length === 0) return;
  event.preventDefault();
  escapeStack[escapeStack.length - 1].current();
}

export function useEscapeLayer(onEscape: () => void, active = true) {
  const handlerRef = useRef(onEscape);
  useLayoutEffect(() => {
    handlerRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    if (!escapeListenerInstalled) {
      document.addEventListener('keydown', onEscapeKeyDown);
      escapeListenerInstalled = true;
    }
    // layer mở sau nằm trên cùng stack
    escapeStack.push(handlerRef);
    return () => {
      const index = escapeStack.indexOf(handlerRef);
      if (index !== -1) escapeStack.splice(index, 1);
    };
  }, [active]);
}
```

Các chi tiết hay bị bỏ sót:

- **Lưu `document.activeElement` trước khi focus vào dialog**, và chỉ trả focus nếu element đó vẫn còn trên trang (`isConnected`).
- **`focusin` trên document** để bắt focus lọt ra ngoài (click vào nền, công cụ trợ năng di chuyển focus). Phải bỏ qua trường hợp focus đi vào một dialog **khác** mở chồng lên trên, nên dialog được đánh dấu bằng `data-focus-trap`.
- **Container có `tabIndex={-1}`**: dialog không có phần tử nào focus được thì vẫn focus được chính nó, và trình đọc màn hình vẫn đọc tiêu đề.
- **Esc stack ở module scope** và chỉ một listener `keydown` cho mọi layer. Layer mở sau thì `push` sau, nên nằm trên cùng.

Component dialog dùng 2 hook trên:

```tsx title=src/demos/FocusTrapDemo.tsx
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer, useFocusTrap } from '../lib/focusTrap';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, true);
  useEscapeLayer(onClose);

  return createPortal(
    <div className='backdrop' onClick={onClose}>
      <div
        ref={ref}
        className='dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
        data-focus-trap
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}
```

## Demo

Mở dialog, bấm **Tab / Shift+Tab** nhiều lần (nút disabled và nút ẩn được bỏ qua). Mở dialog xác nhận rồi bấm **Esc** hai lần, xem focus quay về đâu ở ô "Đang focus".

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/focus-trap" title="Demo focus-trap" loading="lazy" style="height: 520px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/focus-trap" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/focusTrap.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/focusTrap.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Có cần tự viết không?

Trình duyệt hiện đại đã có sẵn [`<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) với `showModal()`. Nó tự làm phần nền phía sau thành `inert`, tự trả focus khi đóng và tự đóng khi bấm Esc. Nếu dự án cho phép, **ưu tiên dùng `<dialog>`** hoặc thư viện như Radix UI / React Aria.

Bạn vẫn cần hiểu kỹ thuật trong bài khi:

- Làm **popover, menu, combobox** không phải modal (không dùng `showModal` được) nhưng vẫn cần quản lý focus và Esc theo layer.
- Cần **Esc chỉ đóng layer trên cùng** khi trộn `<dialog>` với popover tự viết.
- Đọc hiểu và debug các thư viện UI kể trên. Bên trong chúng làm đúng những việc này.

> [!TIP]
> Để chặn tương tác với phần nền khi mở modal tự viết, hãy đặt thuộc tính [`inert`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/inert) lên vùng nội dung chính. Nó chặn cả click, focus lẫn trình đọc màn hình, đơn giản hơn nhiều so với tự lọc từng event.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- **#8 Focus trap + Esc theo layer** (bài này)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

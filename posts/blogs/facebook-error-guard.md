---
title: 'Học Từ Facebook #6: ErrorGuard, Bắt Lỗi Theo Ngữ Cảnh Thay Vì Try/Catch Rải Rác'
description: 'Cách Facebook bọc callback bằng ErrorGuard: guard stack cho biết lỗi xảy ra ở đâu, chuẩn hoá lỗi throw không phải Error, một pipeline chung cho lỗi guarded, global, promise và React. Viết lại bằng TypeScript, có demo.'
date: '2026-10-27T08:00'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-error-guard.png
tags: ['facebook', 'javascript', 'error-handling', 'monitoring', 'react']
---

Stack trace từ production sau khi minify trông như sau:

```text
TypeError: Cannot read properties of undefined (reading 'id')
    at a (main.3f9a1c.js:1:48213)
    at Array.forEach (<anonymous>)
    at c (main.3f9a1c.js:1:51002)
```

Có source map thì bạn biết lỗi ở dòng nào. Nhưng thường bạn vẫn không biết **lỗi xảy ra trong ngữ cảnh nào**: người dùng đang bấm Like, đang load comment, hay event từ websocket? Ngoài ra, một listener lỗi trong vòng `forEach` sẽ làm **các listener sau nó không bao giờ chạy**.

Facebook có cả một nhóm module cho chuyện này: `ErrorGuard`, `ErrorGuardState`, `ErrorPubSub`, `ErrorNormalizeUtils`, `ErrorSerializer`, `ErrorGlobalEventHandler`, `ErrorUnhandledRejectionHandler`… (thư mục `ErrorGuard/` của [facebook-codebase](https://github.com/hunghg255/facebook-codebase)). Phiên bản đơn giản hơn của ErrorGuard cũng có trong [React Native](https://github.com/facebook/react-native/blob/main/packages/polyfills/error-guard.js).

## Facebook làm thế nào?

**1. `applyWithGuard(fn, context, args, { name })`** gọi hàm trong `try/catch`. Lỗi bị bắt lại, **không văng ra ngoài**, nên code gọi (vòng lặp listener, event emitter, scheduler) vẫn chạy tiếp.

**2. Guard stack.** Trước khi gọi, tên guard được `pushGuard` vào một stack toàn cục. Gọi xong thì `popGuard` trong `finally`. Khi lỗi, `guardList` (bản copy của stack) được gắn vào lỗi. Guard lồng nhau cho ra ngữ cảnh đầy đủ: `["Feed.render", "LikeButton.onClick"]`.

**3. Chuẩn hoá lỗi.** `getErrorSafe` biến mọi thứ bị throw (`throw "abc"`, `throw {}`, `throw null`) thành `Error` thật. `ErrorNormalizeUtils` đưa về một format chung (`name`, `message`, `stack`, `loggingSource`, `extra`…).

**4. Một pipeline chung.** Lỗi có guard, `window.onerror`, `unhandledrejection` và lỗi React đều đi qua `ErrorPubSub.reportNormalizedError`, rồi được gửi lên server theo cùng format.

**5. Chế độ `nocatch`.** Khi `Env.nocatch` bật, guard không bắt lỗi nữa mà để lỗi văng ra, giúp DevTools dừng ngay chỗ throw khi debug.

**6. `guard(fn)`** trả về một hàm đã được bọc sẵn, rất tiện để bọc callback trước khi đưa cho thư viện bên ngoài.

## Viết lại

```ts title=src/lib/errorGuard.ts
/**
 * Bắt lỗi theo "ngữ cảnh" (ý tưởng từ ErrorGuard / ErrorPubSub / ErrorNormalizeUtils của Facebook).
 *
 * - `guard(fn, { name })` bọc callback: lỗi bị bắt, chuẩn hoá và gửi tới các listener,
 *   code gọi callback vẫn chạy tiếp.
 * - Guard lồng nhau tạo thành "guard stack", nên khi lỗi ta biết nó xảy ra ở đâu:
 *   ["Feed.onEvent", "LikeButton.onClick"] thay vì chỉ một stack trace đã minify.
 * - Lỗi lọt ra ngoài (window.onerror, unhandledrejection) cũng đi qua cùng một pipeline.
 */

export type ErrorSource = 'GUARDED' | 'GLOBAL' | 'UNHANDLED_REJECTION' | 'REACT';

export interface NormalizedError {
  name: string;
  message: string;
  stack?: string;
  source: ErrorSource;
  /** guard stack lúc lỗi xảy ra, ngoài cùng trước */
  guardList: string[];
  /** lỗi gốc có phải Error không (throw "abc" hay throw {} cũng gặp ngoài đời) */
  wasErrorObject: boolean;
  timestamp: number;
}

type ErrorListener = (error: NormalizedError) => void;

const guardStack: string[] = [];
const listeners = new Set<ErrorListener>();

export const errorGuardConfig = {
  /**
   * true = không bắt lỗi, để lỗi văng ra cho DevTools dừng đúng chỗ (FB gọi là `nocatch`).
   * Hữu ích khi debug local.
   */
  noCatch: false,
};

/** Biến mọi thứ bị `throw` thành Error để luôn có name/message/stack. */
export function toError(thrown: unknown): Error {
  if (thrown instanceof Error) return thrown;
  let message: string;
  try {
    message = typeof thrown === 'string' ? thrown : JSON.stringify(thrown);
  } catch {
    message = String(thrown);
  }
  const error = new Error(`Non-error thrown: ${message}`);
  error.name = 'NonError';
  return error;
}

export function normalizeError(
  thrown: unknown,
  source: ErrorSource,
  guardList: string[] = [],
): NormalizedError {
  const error = toError(thrown);
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    source,
    guardList,
    wasErrorObject: thrown instanceof Error,
    timestamp: Date.now(),
  };
}

export function reportError(error: NormalizedError) {
  listeners.forEach((listener) => {
    try {
      listener(error);
    } catch {
      // listener lỗi thì bỏ qua, không được gây vòng lặp báo lỗi
    }
  });
}

export function onError(listener: ErrorListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function inGuard() {
  return guardStack.length > 0;
}

export interface GuardOptions {
  name?: string;
  onError?: (error: NormalizedError) => void;
}

export function applyWithGuard<A extends unknown[], R>(
  fn: (...args: A) => R,
  thisArg: unknown,
  args: A,
  options: GuardOptions = {},
): R | undefined {
  guardStack.push(options.name ?? (fn.name ? `func_name:${fn.name}` : '<anonymous guard>'));
  try {
    if (errorGuardConfig.noCatch) return fn.apply(thisArg, args);
    try {
      return fn.apply(thisArg, args);
    } catch (thrown) {
      const normalized = normalizeError(thrown, 'GUARDED', [...guardStack]);
      options.onError?.(normalized);
      reportError(normalized);
      return undefined;
    }
  } finally {
    guardStack.pop();
  }
}

export function guard<A extends unknown[], R>(fn: (...args: A) => R, options: GuardOptions = {}) {
  return function (this: unknown, ...args: A) {
    return applyWithGuard(fn, this, args, options);
  };
}

/** Bắt cả lỗi lọt ra ngoài mọi guard. Gọi một lần lúc khởi động app. */
export function installGlobalErrorHandlers() {
  const onWindowError = (event: ErrorEvent) => {
    reportError(normalizeError(event.error ?? event.message, 'GLOBAL'));
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(normalizeError(event.reason, 'UNHANDLED_REJECTION'));
  };
  window.addEventListener('error', onWindowError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onWindowError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
```

## Demo

- **Emit không guard / có guard**: một event emitter có 3 listener, listener thứ 2 bị lỗi. Không có guard thì listener 3 không chạy. Có guard thì cả 3 đều chạy, lỗi vẫn được báo kèm tên guard.
- **Guard lồng nhau**: log hiện đầy đủ `Feed.render › LikeButton.onClick`.
- **throw "string"**, **Promise reject**, **Component lỗi**: đều đi chung pipeline với `source` khác nhau.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/error-guard" title="Demo error-guard" loading="lazy" style="height: 560px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/error-guard" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/errorGuard.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/errorGuard.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Dùng trong dự án

Nối pipeline này với Sentry (hoặc API của bạn) **ở một chỗ duy nhất**:

```ts title=errors.ts
installGlobalErrorHandlers();

onError((error) => {
  Sentry.captureException(new Error(error.message), {
    tags: { source: error.source },
    extra: { guardList: error.guardList, stack: error.stack },
  });
});

errorGuardConfig.noCatch = import.meta.env.DEV && localStorage.debugNoCatch === '1';
```

Những chỗ nên bọc guard:

- **Event emitter / pub-sub** do bạn tự viết: mỗi listener một guard.
- **Callback đưa cho thư viện bên thứ ba** (map, chart, editor) mà bạn không kiểm soát try/catch của họ.
- **Plugin / extension / widget** do người khác viết chạy trong app của bạn.

> [!NOTE]
> Guard stack chỉ đúng với code **đồng bộ**. Sau `await`, stack đã được pop từ lâu. Với code async, hãy truyền tên ngữ cảnh một cách tường minh (ví dụ `normalizeError(e, 'GUARDED', ['Feed.loadMore'])`), hoặc dùng `AsyncContext` khi trình duyệt hỗ trợ.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- **#6 ErrorGuard: bắt lỗi theo ngữ cảnh** (bài này)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

---
title: 'Học Từ Facebook #5: Đừng Tin navigator.onLine, Hãy Dùng Heartbeat Với Exponential Backoff'
description: 'navigator.onLine chỉ biết máy có nối với router hay không. Cách Facebook xác định online/offline bằng tỉ lệ lỗi request và heartbeat có exponential backoff. Viết lại createNetworkStatus và trackedFetch, có demo.'
date: '2026-10-27T08:10'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-network.png
tags: ['facebook', 'javascript', 'network', 'offline', 'react']
---

`navigator.onLine` và hai event `online` / `offline` có vẻ là tất cả những gì cần để hiện banner "Bạn đang offline". Thực tế:

- `navigator.onLine === true` chỉ nghĩa là máy **có kết nối tới một mạng nào đó** (Wi-Fi, LAN). Wi-Fi quán cà phê chưa đăng nhập captive portal, router mất Internet, VPN treo… đều báo `true`.
- Khi mất mạng thật, request của app lỗi **trước khi** trình duyệt kịp bắn `offline`. Có lúc event này không bao giờ tới.

Facebook giải quyết bằng `NetworkStatusImpl` + `NetworkHeartbeat` (thư mục `NetworkStatus/` trong [facebook-codebase](https://github.com/hunghg255/facebook-codebase)).

## Facebook làm thế nào?

**1. Lắng nghe request của chính app.** Lớp request gọi `reportError()` khi lỗi mạng và `reportSuccess()` khi có response. Module giữ hai danh sách mốc thời gian trong cửa sổ **5 giây**.

**2. Chỉ nghi ngờ khi tỉ lệ lỗi cao.** Một request lỗi lẻ tẻ là chuyện thường. Họ chỉ bắt đầu kiểm tra khi số lần thành công **không còn gấp đôi** số lần lỗi trong 5 giây gần nhất.

**3. Heartbeat.** Để kiểm tra, họ gọi một endpoint siêu nhẹ (`XHeartbeatController`, trả về `204 No Content`). **Có response là online**, bất kể status code. Lỗi mạng thì thử lại sau `100ms`, rồi tăng dần tới tối đa `6400ms`. Đây là **exponential backoff**: dày lúc đầu vì mạng chập chờn thường chỉ mất vài trăm ms, thưa dần để không spam khi mất mạng lâu.

**4. Một heartbeat tại một thời điểm.** `isHeartbeatPending()` chặn việc chạy song song nhiều vòng ping. Còn có `killswitch("DISABLE_HEARTBEAT_POLLING")` để tắt từ xa nếu endpoint gặp sự cố.

**5. Kết hợp event của trình duyệt.** `online` / `offline` vẫn được lắng nghe, nhưng chỉ là một nguồn tín hiệu.

Họ còn có `CometNetworkStatusToast` để hiện toast khi mất mạng (dùng toaster ở [bài #4](/blogs/facebook-toast-manager)).

## Viết lại

```ts title=src/lib/networkStatus.ts
import { useSyncExternalStore } from 'react';

/**
 * Trạng thái mạng "đáng tin" hơn navigator.onLine (ý tưởng từ NetworkStatusImpl + NetworkHeartbeat).
 *
 * - navigator.onLine chỉ biết máy có kết nối tới router hay không, không biết có ra được
 *   Internet / tới server của mình hay không.
 * - Khi nghi ngờ (sự kiện offline, request lỗi nhiều), ta gọi một endpoint heartbeat nhỏ.
 *   Lỗi thì thử lại với exponential backoff, tới khi thành công thì báo online.
 */

export type HeartbeatEvent =
  | { type: 'heartbeat-start' }
  | { type: 'heartbeat-ok' }
  | { type: 'heartbeat-fail'; attempt: number; retryIn: number };

export interface NetworkStatusOptions {
  heartbeatUrl: string;
  fetchImpl?: typeof fetch;
  initialDelay?: number;
  maxDelay?: number;
  timeout?: number;
  /** cửa sổ thời gian để tính tỉ lệ lỗi */
  windowMs?: number;
  onHeartbeat?: (event: HeartbeatEvent) => void;
}

export function createNetworkStatus({
  heartbeatUrl,
  fetchImpl = (...args) => fetch(...args),
  initialDelay = 100,
  maxDelay = 6400,
  timeout = 5000,
  windowMs = 5000,
  onHeartbeat,
}: NetworkStatusOptions) {
  let online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const listeners = new Set<() => void>();
  let heartbeatPending = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let errors: number[] = [];
  let successes: number[] = [];

  const setOnline = (next: boolean) => {
    if (online === next) return;
    online = next;
    listeners.forEach((listener) => listener());
  };

  const prune = () => {
    const since = performance.now() - windowMs;
    errors = errors.filter((t) => t > since);
    successes = successes.filter((t) => t > since);
  };

  async function heartbeatOnce() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      // Có response (kể cả 404/500) nghĩa là đã tới được server -> online.
      await fetchImpl(heartbeatUrl, { cache: 'no-store', signal: controller.signal });
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function runHeartbeat() {
    if (await heartbeatOnce()) {
      heartbeatPending = false;
      attempt = 0;
      onHeartbeat?.({ type: 'heartbeat-ok' });
      setOnline(true);
      return;
    }
    setOnline(false);
    // 100ms, 200ms, 400ms ... tối đa maxDelay: ping dày lúc đầu (mạng hay chập chờn
    // vài trăm ms) rồi thưa dần để không spam khi mất mạng lâu.
    const retryIn = Math.min(initialDelay * 2 ** attempt, maxDelay);
    attempt++;
    onHeartbeat?.({ type: 'heartbeat-fail', attempt, retryIn });
    retryTimer = setTimeout(runHeartbeat, retryIn);
  }

  function startHeartbeat() {
    if (heartbeatPending) return; // đang ping rồi thì thôi
    heartbeatPending = true;
    onHeartbeat?.({ type: 'heartbeat-start' });
    void runHeartbeat();
  }

  const onBrowserOnline = () => startHeartbeat(); // "online" có thể sai -> xác nhận lại
  const onBrowserOffline = () => {
    setOnline(false);
    startHeartbeat();
  };
  window.addEventListener('online', onBrowserOnline);
  window.addEventListener('offline', onBrowserOffline);

  return {
    isOnline: () => online,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Gọi khi một request của app lỗi mạng. */
    reportError() {
      errors.push(performance.now());
      prune();
      // Thỉnh thoảng lỗi một request là bình thường. Chỉ nghi ngờ mất mạng khi
      // số lần thành công không còn gấp đôi số lần lỗi trong `windowMs` gần nhất.
      if (successes.length < errors.length * 2) startHeartbeat();
    },
    /** Gọi khi một request của app có response. */
    reportSuccess() {
      successes.push(performance.now());
      prune();
      if (!online && !heartbeatPending) setOnline(true);
    },
    destroy() {
      clearTimeout(retryTimer);
      window.removeEventListener('online', onBrowserOnline);
      window.removeEventListener('offline', onBrowserOffline);
    },
  };
}

export type NetworkStatus = ReturnType<typeof createNetworkStatus>;

/** Bọc fetch để tự báo thành công/lỗi cho NetworkStatus. */
export function trackedFetch(status: NetworkStatus, fetchImpl: typeof fetch = fetch): typeof fetch {
  return async (...args) => {
    try {
      const response = await fetchImpl(...args);
      status.reportSuccess();
      return response;
    } catch (error) {
      // AbortError là do mình huỷ, không phải lỗi mạng
      if (!(error instanceof DOMException && error.name === 'AbortError')) status.reportError();
      throw error;
    }
  };
}

export function useOnline(status: NetworkStatus) {
  return useSyncExternalStore(status.subscribe, status.isOnline);
}
```

Vài điểm khác so với bản gốc:

- Event `online` của trình duyệt **không** chuyển thẳng sang online mà chạy heartbeat để xác nhận, vì event này có thể sai.
- Heartbeat có **timeout** bằng `AbortController`. Mạng 2G có khi treo cả phút, không thể đợi mãi.
- `trackedFetch` bọc `fetch` để tự báo thành công/lỗi. `AbortError` (do mình chủ động huỷ) không bị tính là lỗi mạng.
- Backoff là `initialDelay * 2^attempt`: 100, 200, 400, 800, 1600, 3200, 6400, 6400…

## Demo

Không thể rút dây mạng của bạn được, nên demo dùng một `fetch` giả. Bật **Giả lập mất mạng**, bấm **Gọi API**, xem heartbeat giãn dần. Tắt công tắc, heartbeat kế tiếp sẽ thành công.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/network-status" title="Demo network-status" loading="lazy" style="height: 520px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/network-status" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/networkStatus.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/networkStatus.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Dùng trong dự án

```ts title=network.ts
export const network = createNetworkStatus({ heartbeatUrl: '/api/health' });
export const api = trackedFetch(network);
```

```tsx
function OfflineBanner() {
  const online = useOnline(network);
  return online ? null : <div role='status'>Mất kết nối. Đang thử kết nối lại…</div>;
}
```

Endpoint heartbeat nên:

- **Trả về `204`** với body rỗng, không chạm database, không cần auth.
- Có header `Cache-Control: no-store`, nếu không thì service worker hoặc CDN có thể trả về bản cache khi đang offline.
- Cùng origin với app, để kiểm tra đúng đường đi tới server của bạn.

> [!TIP]
> Khi dùng backoff cho **nhiều client** cùng lúc (ví dụ server sập rồi sống lại), nên thêm **jitter**: `retryIn * (0.5 + Math.random())`. Hàng triệu client sẽ không cùng ping vào đúng một mili-giây.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- **#5 Network status + heartbeat backoff** (bài này)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- [#7 Banzai: gom log theo lô + sendBeacon](/blogs/facebook-batch-logger)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

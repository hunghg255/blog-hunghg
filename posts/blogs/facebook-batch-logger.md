---
title: 'Học Từ Facebook #7: Banzai, Gom Log Phía Client Theo Lô Và Gửi Bằng sendBeacon'
description: 'Cách Banzai, hệ thống logging phía client của Facebook, gom event theo lô, chia mức ưu tiên vital/basic, retry khi lỗi và dùng sendBeacon khi trang đóng. Viết lại createBatchLogger bằng TypeScript, có demo.'
date: '2026-10-27T07:50'
author: hunghg255
image: https://blog.hunghg.me/blogs/fb-banzai.png
tags: ['facebook', 'javascript', 'analytics', 'logging', 'performance']
---

Mỗi lần người dùng cuộn feed, Facebook ghi lại hàng chục event: bài nào hiện, hiện bao lâu ([bài #2](/blogs/facebook-use-viewport-duration)), video chạy mấy giây, có lỗi gì ([bài #6](/blogs/facebook-error-guard)), thời gian render… Mỗi event một request thì mạng và pin điện thoại không chịu nổi.

Hệ thống lo việc này tên là **Banzai** (thư mục `24.Banzai/`, `00 BanzaiComet/` trong [facebook-codebase](https://github.com/hunghg255/facebook-codebase)).

## Facebook làm thế nào?

**1. Gom theo lô.** `post(route, data)` chỉ đẩy event vào buffer. Buffer được gửi theo lịch. Nhiều event, một request.

**2. Hai mức ưu tiên.** Mỗi event thuộc `vital` hoặc `basic`, mỗi mức có buffer và thời gian chờ riêng. Lỗi JS, trace hiệu năng (`falco:perf`, `js_error_logging`) là vital, gửi sớm. Event hành vi thông thường chờ lâu hơn để gom được nhiều.

**3. Nén payload** (`BanzaiCompressionUtils`) trước khi gửi.

**4. Gửi ở độ ưu tiên thấp.** Lịch gửi dùng `setTimeoutCometLoggingPri` / `Speculative`, tức là chạy khi main thread rảnh, không tranh CPU với việc render.

**5. `sendBeacon` khi rời trang.** Khi trang bị ẩn hoặc đóng, buffer còn lại được gửi bằng `navigator.sendBeacon`. Họ còn log riêng trường hợp `send_via_beacon_failure`.

**6. Tự đo chính mình.** Banzai đếm `messages_sent`, `messages_received`, `total_messages_*` và gửi lên ODS (hệ thống metric nội bộ) để biết bao nhiêu % log bị thất lạc.

## Viết lại

```ts title=src/lib/batchLogger.ts
/**
 * Client logging gom theo lô (ý tưởng từ Banzai - hệ thống logging phía client của Facebook).
 *
 * - Không gửi 1 request cho mỗi event: gom lại, gửi theo lô.
 * - 2 mức ưu tiên: `vital` (lỗi, thanh toán…) gửi nhanh, `basic` (click, view…) chờ lâu hơn.
 * - Lô đầy thì gửi ngay, không chờ hẹn giờ.
 * - Gửi lỗi thì đưa lại vào hàng đợi, quá số lần thử thì bỏ.
 * - Tab bị ẩn / rời trang thì gửi hết bằng navigator.sendBeacon (request không bị huỷ khi trang đóng).
 */

export type Priority = 'vital' | 'basic';

export interface LogEvent {
  event: string;
  data?: Record<string, unknown>;
  time: number;
  retries: number;
}

export interface Transport {
  /** gửi bình thường, reject nếu lỗi */
  send(url: string, body: string): Promise<void>;
  /** gửi lúc trang sắp đóng, trả về false nếu trình duyệt từ chối */
  beacon(url: string, body: string): boolean;
}

export const browserTransport: Transport = {
  async send(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  },
  beacon(url, body) {
    return navigator.sendBeacon?.(url, new Blob([body], { type: 'application/json' })) ?? false;
  },
};

export interface BatchLoggerOptions {
  endpoint: string;
  transport?: Transport;
  /** thời gian chờ trước khi gửi, theo mức ưu tiên */
  delays?: Record<Priority, number>;
  maxBatchSize?: number;
  maxRetries?: number;
}

export function createBatchLogger({
  endpoint,
  transport = browserTransport,
  delays = { vital: 1000, basic: 5000 },
  maxBatchSize = 50,
  maxRetries = 3,
}: BatchLoggerOptions) {
  const queues: Record<Priority, LogEvent[]> = { vital: [], basic: [] };
  const timers: Partial<Record<Priority, ReturnType<typeof setTimeout>>> = {};
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function schedule(priority: Priority) {
    if (timers[priority] != null) return; // đã hẹn rồi, event mới đi chung chuyến
    timers[priority] = setTimeout(() => {
      timers[priority] = undefined;
      void flushQueue(priority);
    }, delays[priority]);
  }

  async function flushQueue(priority: Priority) {
    clearTimeout(timers[priority]);
    timers[priority] = undefined;
    const batch = queues[priority].splice(0, maxBatchSize);
    if (batch.length === 0) return;
    notify();

    try {
      await transport.send(endpoint, JSON.stringify({ priority, events: batch }));
    } catch {
      const retry = batch
        .map((e) => ({ ...e, retries: e.retries + 1 }))
        .filter((e) => e.retries <= maxRetries);
      // đưa lại lên đầu hàng đợi để giữ đúng thứ tự thời gian
      queues[priority].unshift(...retry);
      notify();
    }
    if (queues[priority].length > 0) schedule(priority);
  }

  /** Gửi tất cả ngay bằng sendBeacon, dùng khi trang sắp bị đóng. */
  function flushWithBeacon() {
    (['vital', 'basic'] as const).forEach((priority) => {
      clearTimeout(timers[priority]);
      timers[priority] = undefined;
      while (queues[priority].length > 0) {
        const batch = queues[priority].splice(0, maxBatchSize);
        const ok = transport.beacon(endpoint, JSON.stringify({ priority, events: batch }));
        if (!ok) {
          // Beacon bị từ chối (thường do payload > 64KB): trả lại hàng đợi.
          // Bản production có thể lưu tạm vào localStorage để lần sau gửi tiếp.
          queues[priority].unshift(...batch);
          break;
        }
      }
    });
    notify();
  }

  // `visibilitychange -> hidden` là tín hiệu đáng tin nhất trên mobile
  // (beforeunload/unload thường không chạy khi người dùng vuốt tắt app).
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flushWithBeacon();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', flushWithBeacon);

  return {
    log(event: string, data?: Record<string, unknown>, priority: Priority = 'basic') {
      queues[priority].push({ event, data, time: Date.now(), retries: 0 });
      notify();
      if (queues[priority].length >= maxBatchSize) void flushQueue(priority);
      else schedule(priority);
    },
    flush: () => Promise.all([flushQueue('vital'), flushQueue('basic')]),
    flushWithBeacon,
    getQueueSizes: () => ({ vital: queues.vital.length, basic: queues.basic.length }),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    destroy() {
      clearTimeout(timers.vital);
      clearTimeout(timers.basic);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', flushWithBeacon);
    },
  };
}

export type BatchLogger = ReturnType<typeof createBatchLogger>;
```

Những quyết định quan trọng:

- **`visibilitychange → hidden` thay vì `beforeunload` / `unload`.** Trên mobile, người dùng vuốt tắt app hoặc chuyển app thì `unload` thường không chạy, nhưng `visibilitychange` thì có. `unload` còn làm trang mất bfcache.
- **`sendBeacon` có giới hạn khoảng 64KB** cho tổng payload đang chờ gửi. Bị từ chối thì trả về `false`, nên phải kiểm tra kết quả và chia lô (`maxBatchSize`).
- **Retry có giới hạn.** Event lỗi được đưa lại **đầu** hàng đợi (giữ thứ tự thời gian), quá `maxRetries` thì bỏ. Log không đáng để làm treo app.
- **`keepalive: true`** cho `fetch` thường. Request vẫn hoàn thành dù người dùng chuyển trang giữa chừng.

## Demo

Transport trong demo chỉ in ra log thay vì gửi thật. Thử:

- Bấm **Log click** vài lần: 5 giây sau mới có **một** request.
- **Log lỗi thanh toán (vital)**: chỉ chờ 1 giây.
- **Spam 45 event**: đủ 20 event là gửi ngay một lô, không chờ.
- Bật **Server lỗi** rồi log: event được xếp lại hàng đợi và thử lại.
- **Giả lập rời trang** hoặc chuyển sang tab khác: phần còn lại đi bằng `sendBeacon`.

<iframe class="demo-frame" src="/demos/facebook-patterns/index.html?theme=dark#/batch-logger" title="Demo batch-logger" loading="lazy" style="height: 540px"></iframe>

<p class="demo-links">▶ <a href="/demos/facebook-patterns/index.html#/batch-logger" target="_blank" rel="noopener">Mở demo toàn màn hình ↗</a> · <a href="https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns?file=src/lib/batchLogger.ts" target="_blank" rel="noopener">Sửa code trên StackBlitz ↗</a> · <a href="https://github.com/hunghg255/blog-hunghg/blob/master/examples/facebook-patterns/src/lib/batchLogger.ts" target="_blank" rel="noopener">Xem source trên GitHub ↗</a></p>

## Dùng trong dự án

```ts title=logger.ts
export const logger = createBatchLogger({ endpoint: '/api/log' });

logger.log('page_view', { path: location.pathname });
logger.log('checkout_error', { code }, 'vital');
```

Phía server, endpoint `/api/log` nên trả về ngay (`202 Accepted`) rồi đẩy vào queue (Kafka, SQS…), không xử lý đồng bộ. Đây cũng là cách mọi SDK analytics lớn (Segment, Amplitude, PostHog…) vận hành. Nếu bạn đang tự viết tracking, đừng gửi mỗi event một request.

> [!TIP]
> Muốn không mất log khi trình duyệt crash hoặc beacon bị từ chối, hãy lưu hàng đợi vào `localStorage` / IndexedDB rồi gửi tiếp ở lần mở trang sau. Banzai làm đúng như vậy với `BanzaiStorage`: `_store()` lưu cả buffer vital lẫn basic, lần tải trang sau `restore()` lại và gửi tiếp. Mọi lời gọi storage đều được bọc trong `ErrorGuard` ([bài #6](/blogs/facebook-error-guard)), nên storage lỗi (hết quota, chế độ ẩn danh) cũng không làm hỏng việc logging.

---

**Series "Học từ mã nguồn Facebook"**

- [Mở đầu: cách đọc code minify của Facebook](/blogs/learn-from-facebook-source-code)
- [#1 Dùng chung IntersectionObserver + infinite scroll](/blogs/facebook-shared-intersection-observer)
- [#2 useViewportDuration: đo thời gian thực sự được xem](/blogs/facebook-use-viewport-duration)
- [#3 Preload code + data khi hover](/blogs/facebook-preload-on-hover)
- [#4 Toast manager với external store](/blogs/facebook-toast-manager)
- [#5 Network status + heartbeat backoff](/blogs/facebook-network-status-heartbeat)
- [#6 ErrorGuard: bắt lỗi theo ngữ cảnh](/blogs/facebook-error-guard)
- **#7 Banzai: gom log theo lô + sendBeacon** (bài này)
- [#8 Focus trap + Esc theo layer](/blogs/facebook-focus-trap)

Code + demo: [`examples/facebook-patterns`](https://github.com/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns) · [Mở trên StackBlitz](https://stackblitz.com/github/hunghg255/blog-hunghg/tree/master/examples/facebook-patterns)

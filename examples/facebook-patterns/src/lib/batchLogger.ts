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
  // số lần gửi lỗi liên tiếp, để giãn dần lịch gửi khi server đang có vấn đề
  const failures: Record<Priority, number> = { vital: 0, basic: 0 };
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  function schedule(priority: Priority) {
    if (timers[priority] != null) return; // đã hẹn rồi, event mới đi chung chuyến
    // 1 lần lỗi -> chờ gấp đôi, 2 lần -> gấp 4… tối đa gấp 32
    const delay = delays[priority] * 2 ** Math.min(failures[priority], 5);
    timers[priority] = setTimeout(() => {
      timers[priority] = undefined;
      void flushQueue(priority);
    }, delay);
  }

  async function flushQueue(priority: Priority) {
    clearTimeout(timers[priority]);
    timers[priority] = undefined;
    const batch = queues[priority].splice(0, maxBatchSize);
    if (batch.length === 0) return;
    notify();

    try {
      await transport.send(endpoint, JSON.stringify({ priority, events: batch }));
      failures[priority] = 0;
    } catch {
      failures[priority]++;
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

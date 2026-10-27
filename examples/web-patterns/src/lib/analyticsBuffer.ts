/**
 * Giữ sự kiện analytics trong hàng đợi tới khi SDK tải xong, rồi xả theo đúng thứ tự cần thiết
 * (ý tưởng từ bestbuy.ca: client/utils/analytics/eventBuffer.ts).
 *
 * - Hàng đợi vòng có giới hạn: đầy thì bỏ sự kiện cũ nhất, không giữ vô hạn.
 * - Sự kiện "ưu tiên" (vd page view) KHÔNG bao giờ bị bỏ và luôn được gửi trước:
 *   công cụ analytics thường cần page view có mặt trước các sự kiện khác của trang đó.
 * - Bỏ sự kiện nào thì đếm lại và gửi một sự kiện báo mất dữ liệu.
 * - SDK đã sẵn sàng nhưng chưa có page view: tiếp tục giữ, xả ngay khi page view tới.
 */

export interface AnalyticsEvent {
  name: string;
  data?: Record<string, unknown>;
  /** performance.now() lúc sự kiện xảy ra, để bên nhận biết thứ tự thật */
  at: number;
}

export interface AnalyticsBufferOptions {
  /** số sự kiện thường giữ tối đa (Best Buy: 50) */
  max?: number;
  /**
   * Sự kiện ưu tiên: không bị bỏ, gửi trước tiên. Có truyền hàm này thì hàng đợi chỉ được xả
   * khi đã có ít nhất một sự kiện ưu tiên (giống Best Buy chờ PAGE_LOAD).
   */
  isPriority?: (event: AnalyticsEvent) => boolean;
}

export function createAnalyticsBuffer({ max = 50, isPriority }: AnalyticsBufferOptions = {}) {
  const waitForPriority = isPriority !== undefined;
  const priority: AnalyticsEvent[] = [];
  const normal: AnalyticsEvent[] = [];
  let dropped = 0;
  let sink: ((event: AnalyticsEvent) => void) | null = null;
  let open = false; // true: gửi thẳng, không qua hàng đợi

  const flush = () => {
    if (!sink) return;
    if (waitForPriority && priority.length === 0) return; // chưa có page view: giữ tiếp
    const send = sink;
    priority.splice(0).forEach(send);
    if (dropped > 0) {
      send({ name: 'analytics_buffer_overflow', data: { dropped }, at: performance.now() });
      dropped = 0;
    }
    normal.splice(0).forEach(send);
    open = true;
  };

  return {
    track(name: string, data?: Record<string, unknown>) {
      const event: AnalyticsEvent = { name, data, at: performance.now() };
      if (open && sink) {
        sink(event);
        return;
      }
      if (isPriority?.(event)) {
        priority.push(event);
        flush();
        return;
      }
      if (normal.length >= max) {
        normal.shift();
        dropped++;
      }
      normal.push(event);
    },
    /** Gọi khi SDK đã tải xong. */
    connect(send: (event: AnalyticsEvent) => void) {
      sink = send;
      flush();
    },
    stats: () => ({ priority: priority.length, normal: normal.length, dropped, open }),
  };
}

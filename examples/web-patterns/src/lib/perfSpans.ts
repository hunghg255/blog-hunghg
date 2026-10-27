/**
 * Đo "span" (một việc có điểm đầu, điểm cuối) bằng User Timing API rồi gửi về server theo
 * nhịp có giới hạn. Ý tưởng từ PerformanceTelemetryService của web.postman.co
 * (js/services/PerformanceTelemetryService/).
 *
 * - startSpan/end dùng performance.mark + performance.measure: span hiện luôn trong tab
 *   Performance của DevTools, và mốc thời gian là đồng hồ đơn điệu của trình duyệt.
 * - marker(): đo từ lúc bắt đầu điều hướng (timeOrigin) tới bây giờ, vd "lần đầu vẽ xong tab".
 * - Harvester: gom vào hàng đợi, mỗi chu kỳ chỉ gửi tối đa `rateLimit` sự kiện.
 */

export interface SpanEvent {
  name: string;
  domain: string;
  startTime: number;
  duration: number;
  /** ngưỡng Apdex: dưới ngưỡng là "hài lòng" */
  apdexMs: number;
}

export interface TelemetryOptions {
  /** gửi một lô sự kiện (Postman gọi newrelic.addPageAction cho từng sự kiện) */
  report: (events: SpanEvent[]) => void;
  /** lần gửi đầu tiên sau bao lâu (Postman: 25s, để không tranh tài nguyên lúc khởi động) */
  harvestStartMs?: number;
  harvestIntervalMs?: number;
  /** tối đa bao nhiêu sự kiện mỗi chu kỳ (Postman: 60 / 30s) */
  rateLimit?: number;
  /** hàng đợi không được phình vô hạn khi người dùng để tab mở cả ngày */
  maxQueue?: number;
  domains?: readonly string[];
  /** giống Postman: lỗi đo lường không bao giờ được làm hỏng tính năng */
  onError?: (error: Error) => void;
}

const PREFIX = 'telemetry';

export function createTelemetry({
  report,
  harvestStartMs = 25_000,
  harvestIntervalMs = 30_000,
  rateLimit = 60,
  maxQueue = 500,
  domains,
  onError = () => {},
}: TelemetryOptions) {
  const queue: SpanEvent[] = [];
  const active = new Map<string, string>(); // khoá span -> tên mark bắt đầu
  let dropped = 0;
  let seq = 0;

  function enqueue(event: SpanEvent) {
    queue.push(event);
    if (queue.length > maxQueue) {
      queue.shift(); // bỏ sự kiện cũ nhất
      dropped++;
    }
  }

  function measure(name: string, domain: string, apdexMs: number, start?: string) {
    const measureName = `${PREFIX}:${domain}:${name}`;
    // không có start: tính từ timeOrigin (lúc bắt đầu điều hướng).
    // `detail` gắn thêm dữ liệu vào entry, DevTools và PerformanceObserver đều đọc được.
    const entry = performance.measure(measureName, { start: start ?? 0, detail: { apdexMs } });
    // Trình duyệt cũ trả về undefined thay vì PerformanceMeasure
    const m = entry ?? performance.getEntriesByName(measureName, 'measure').at(-1)!;
    enqueue({ name, domain, startTime: m.startTime, duration: m.duration, apdexMs });
    performance.clearMeasures(measureName);
  }

  function startSpan(name: string, { domain = 'app', uid = '', apdexMs = 250 } = {}) {
    const key = `${domain}:${name}:${uid}`;
    try {
      if (domains && !domains.includes(domain)) throw new Error(`domain không hợp lệ: ${domain}`);
      if (active.has(key)) throw new Error(`span "${key}" đang chạy, chưa end`);
      const startMark = `${PREFIX}:start:${key}:${seq++}`;
      performance.mark(startMark);
      active.set(key, startMark);
    } catch (error) {
      onError(error as Error);
    }
    let ended = false;
    return {
      end() {
        if (ended) return;
        ended = true;
        const startMark = active.get(key);
        if (!startMark) return;
        active.delete(key);
        try {
          measure(name, domain, apdexMs, startMark);
        } catch (error) {
          onError(error as Error);
        } finally {
          performance.clearMarks(startMark);
        }
      },
      /** huỷ span (vd người dùng chuyển trang giữa chừng): không gửi số đo dở dang */
      cancel() {
        ended = true;
        const startMark = active.get(key);
        active.delete(key);
        if (startMark) performance.clearMarks(startMark);
      },
    };
  }

  function marker(name: string, { domain = 'app', apdexMs = 1000 } = {}) {
    try {
      measure(name, domain, apdexMs);
    } catch (error) {
      onError(error as Error);
    }
  }

  function harvest(limit = rateLimit) {
    const batch = queue.splice(0, limit);
    if (batch.length > 0) report(batch);
    return batch.length;
  }

  // Chu kỳ gửi: chờ harvestStartMs rồi gửi đều đặn
  let interval: ReturnType<typeof setInterval> | undefined;
  const startTimer = setTimeout(() => {
    harvest();
    interval = setInterval(harvest, harvestIntervalMs);
  }, harvestStartMs);

  // Postman gửi lần cuối ở beforeunload; trên mobile sự kiện đó hay không chạy,
  // visibilitychange -> hidden đáng tin hơn (xem bài Banzai trong series Facebook).
  const onHidden = () => {
    if (document.visibilityState === 'hidden') harvest(Infinity);
  };
  document.addEventListener('visibilitychange', onHidden);

  return {
    startSpan,
    marker,
    harvest,
    stats: () => ({ queued: queue.length, active: active.size, dropped }),
    destroy() {
      clearTimeout(startTimer);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onHidden);
    },
  };
}

export type Telemetry = ReturnType<typeof createTelemetry>;

/**
 * RUM (Real User Monitoring) tự viết bằng PerformanceObserver (ý tưởng từ observers/ của Udemy):
 * đo FCP, LCP, CLS, TBT, INP ngay trên máy người dùng, dừng khi tab bị ẩn hoặc sau một khoảng
 * thời gian cố định, rồi trả một bản tóm tắt để gửi đi bằng sendBeacon.
 */

export type ObserveCallback = (entries: PerformanceEntry[]) => void;

/**
 * Bọc PerformanceObserver: kiểm tra trình duyệt hỗ trợ loại entry, lấy cả entry đã xảy ra
 * trước khi đăng ký (`buffered`). Trả về hàm huỷ, hoặc null nếu không hỗ trợ.
 */
export function observe(
  type: string,
  callback: ObserveCallback,
  options: Record<string, unknown> = {},
): (() => void) | null {
  try {
    if (!PerformanceObserver.supportedEntryTypes?.includes(type)) return null;
    const observer = new PerformanceObserver((list) => callback(list.getEntries()));
    observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
    return () => observer.disconnect();
  } catch {
    return null;
  }
}

// Các trường không có trong kiểu PerformanceEntry chung
interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface EventTimingEntry extends PerformanceEntry {
  interactionId?: number;
}

/**
 * CLS theo định nghĩa hiện tại: gom các shift thành "phiên" (cách nhau < 1s, cả phiên < 5s),
 * lấy phiên lớn nhất. Bỏ shift xảy ra trong 500ms sau input của người dùng (hadRecentInput).
 */
export function createClsTracker() {
  let current = 0;
  let firstTs = 0;
  let lastTs = 0;
  let max = 0;
  return {
    add(entries: PerformanceEntry[]) {
      // Duyệt HẾT danh sách: một lần callback có thể mang nhiều entry (nhất là lần đầu với
      // buffered: true). Udemy chỉ lấy entry cuối bằng .pop() nên đếm thiếu.
      for (const entry of entries as LayoutShiftEntry[]) {
        if (entry.hadRecentInput) continue;
        const sameSession = current > 0 && entry.startTime - lastTs < 1000 && entry.startTime - firstTs < 5000;
        if (sameSession) {
          current += entry.value;
        } else {
          current = entry.value;
          firstTs = entry.startTime;
        }
        lastTs = entry.startTime;
        max = Math.max(max, current);
      }
    },
    get value() {
      return max;
    },
  };
}

/**
 * INP xấp xỉ: mỗi tương tác (interactionId) lấy event chậm nhất; INP là tương tác chậm nhất,
 * bỏ 1 tương tác cao nhất cho mỗi 50 tương tác (gần với cách web-vitals làm).
 */
export function createInpTracker() {
  const byInteraction = new Map<number, number>();
  return {
    add(entries: PerformanceEntry[]) {
      for (const entry of entries as EventTimingEntry[]) {
        if (!entry.interactionId) continue;
        const prev = byInteraction.get(entry.interactionId) ?? 0;
        byInteraction.set(entry.interactionId, Math.max(prev, entry.duration));
      }
    },
    get value(): number | undefined {
      if (byInteraction.size === 0) return undefined;
      const sorted = [...byInteraction.values()].sort((a, b) => b - a);
      return sorted[Math.min(sorted.length - 1, Math.floor(byInteraction.size / 50))];
    },
    get count() {
      return byInteraction.size;
    },
  };
}

export interface RumSummary {
  fcp?: number;
  lcp?: number;
  cls: number;
  tbt: number;
  inp?: number;
  interactions: number;
  longTasks: number;
  stoppedBy: 'hidden' | 'timeout' | 'manual' | null;
}

export interface RumOptions {
  /** gọi mỗi khi số liệu đổi (để vẽ lên màn hình) */
  onUpdate?: (summary: RumSummary) => void;
  /** gọi một lần khi dừng đo, nơi gửi beacon */
  onStop?: (summary: RumSummary) => void;
  /** Udemy: 30 giây, để số liệu giữa các phiên so sánh được với nhau */
  maxObservationMs?: number;
}

/** Giới hạn trên cho mốc thời gian, tránh vài giá trị cực lớn làm lệch thống kê (Udemy: 60s). */
const cap = (ms: number, max = 60_000) => Math.min(ms, max);

export function createRum({ onUpdate, onStop, maxObservationMs = 30_000 }: RumOptions = {}) {
  const cls = createClsTracker();
  const inp = createInpTracker();
  const longTasks: { start: number; duration: number }[] = [];
  let fcp: number | undefined;
  let lcp: number | undefined;
  let lcpFinal = false;
  let stoppedBy: RumSummary['stoppedBy'] = null;
  const cleanups: Array<() => void> = [];

  const summary = (): RumSummary => ({
    fcp,
    lcp,
    cls: Number(cls.value.toFixed(4)),
    // TBT: phần vượt 50ms của mỗi long task SAU FCP (trước FCP người dùng chưa thấy gì để bấm)
    tbt: fcp == null ? 0 : longTasks.filter((t) => t.start >= fcp!).reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0),
    inp: inp.value,
    interactions: inp.count,
    longTasks: longTasks.length,
    stoppedBy,
  });
  const update = () => onUpdate?.(summary());
  const track = (stop: (() => void) | null) => stop && cleanups.push(stop);

  track(
    observe('paint', (entries) => {
      const entry = entries.find((e) => e.name === 'first-contentful-paint');
      if (entry) fcp = cap(entry.startTime);
      update();
    }),
  );
  track(
    observe('largest-contentful-paint', (entries) => {
      if (lcpFinal) return;
      // entry cuối cùng là phần tử lớn nhất tính tới lúc này
      lcp = cap(entries[entries.length - 1].startTime);
      update();
    }),
  );
  // Sau tương tác đầu tiên, LCP không còn ý nghĩa (nội dung đổi do người dùng): chốt lại.
  const finalizeLcp = () => {
    lcpFinal = true;
    update();
  };
  for (const type of ['keydown', 'pointerdown']) {
    addEventListener(type, finalizeLcp, { once: true, capture: true });
    cleanups.push(() => removeEventListener(type, finalizeLcp, { capture: true }));
  }
  track(
    observe('layout-shift', (entries) => {
      cls.add(entries);
      update();
    }),
  );
  track(
    observe('longtask', (entries) => {
      // name 'self': long task của chính trang này (không tính iframe khác origin)
      for (const e of entries) if (e.name === 'self') longTasks.push({ start: e.startTime, duration: e.duration });
      update();
    }),
  );
  track(
    observe(
      'event',
      (entries) => {
        inp.add(entries);
        update();
      },
      { durationThreshold: 40 },
    ),
  );
  // first-input: tương tác đầu tiên có thể nhanh hơn ngưỡng 40ms của 'event', vẫn cần đếm
  track(observe('first-input', (entries) => (inp.add(entries), update())));

  const stop = (reason: Exclude<RumSummary['stoppedBy'], null>) => {
    if (stoppedBy) return;
    stoppedBy = reason;
    cleanups.forEach((fn) => fn());
    clearTimeout(timer);
    removeEventListener('visibilitychange', onHidden);
    const result = summary();
    onUpdate?.(result);
    onStop?.(result);
  };
  // Tab bị ẩn: dừng đo và gửi ngay (có thể người dùng không bao giờ quay lại).
  const onHidden = () => document.visibilityState === 'hidden' && stop('hidden');
  addEventListener('visibilitychange', onHidden);
  const timer = setTimeout(() => stop('timeout'), maxObservationMs);

  return { summary, stop: () => stop('manual') };
}

/** Gửi bản tóm tắt khi trang sắp đóng: sendBeacon không bị huỷ khi trang unload. */
export function sendSummary(url: string, summary: RumSummary & Record<string, unknown>) {
  const body = JSON.stringify(summary);
  if (!navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' }))) {
    void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => {});
  }
}

/**
 * Theo dõi long task (việc chiếm main thread > 50ms) và tách phần "chặn" (blocking) ra để
 * vẽ lên dòng thời gian, như biểu đồ Main Thread Activity của calibreapp.com
 * (app/assets/javascripts/utils/mainThreadActivity.js).
 *
 * Calibre lấy dữ liệu từ Lighthouse chạy trên server. Ở đây lấy ngay trong trình duyệt của
 * người dùng bằng PerformanceObserver (entry type 'longtask', chỉ Chromium hỗ trợ).
 */

/** Ngưỡng của định nghĩa long task và của Total Blocking Time. */
export const LONG_TASK_MS = 50;

export interface TaskSegment {
  start: number;
  duration: number;
  /** phần vượt 50ms: khoảng thời gian một cú click sẽ phải chờ thêm */
  blocking: number;
}

export function toSegment(start: number, duration: number): TaskSegment {
  return { start, duration, blocking: Math.max(0, duration - LONG_TASK_MS) };
}

/** Total Blocking Time: tổng phần vượt 50ms của mọi task. */
export function totalBlockingTime(segments: TaskSegment[]) {
  return segments.reduce((sum, s) => sum + s.blocking, 0);
}

export const supportsLongTasks = () =>
  typeof PerformanceObserver !== 'undefined' &&
  (PerformanceObserver.supportedEntryTypes ?? []).includes('longtask');

/**
 * Gọi `onTask` cho mỗi long task. `buffered: true` để nhận cả task xảy ra trước khi đăng ký
 * (trong lúc tải trang). Trình duyệt không hỗ trợ thì trả về hàm huỷ rỗng.
 */
export function observeLongTasks(onTask: (segment: TaskSegment) => void): () => void {
  if (!supportsLongTasks()) return () => {};
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) onTask(toSegment(entry.startTime, entry.duration));
  });
  observer.observe({ type: 'longtask', buffered: true });
  return () => observer.disconnect();
}

/** Chặn main thread `ms` mili giây (chỉ để demo / test). */
export function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // cố ý không làm gì
  }
}

/**
 * Đo độ trễ khi người dùng bấm: từ lúc trình duyệt nhận sự kiện tới lúc handler kịp chạy
 * (ý tưởng từ outlook.live.com: owa-useractivity-manager/src/userActivityManager.ts).
 *
 * `event.timeStamp` là lúc sự kiện được tạo, `performance.now()` trong handler là lúc nó được xử lý.
 * Main thread đang bận (JS dài, layout lớn) thì khoảng cách này lớn: người dùng thấy trang "đơ".
 */

export interface InputDelayReport {
  type: string;
  delay: number;
  /** thời điểm sự kiện xảy ra (performance.now) */
  at: number;
}

export function observeInputDelay(
  onReport: (report: InputDelayReport) => void,
  { threshold = 50, target = document as Document | Element }: { threshold?: number; target?: Document | Element } = {},
) {
  const handle = (event: Event) => {
    // Alt/Shift đơn lẻ thường là một phần của tổ hợp phím, Outlook cũng bỏ qua
    const key = (event as KeyboardEvent).key;
    if (key === 'Alt' || key === 'Shift') return;
    const delay = performance.now() - event.timeStamp;
    if (delay < threshold) return;
    // Báo cáo ở task sau, ngoài handler: không làm sự kiện đang trễ trễ thêm
    setTimeout(() => onReport({ type: event.type, delay, at: event.timeStamp }));
  };
  // capture: chạy trước mọi handler khác; passive: không bao giờ preventDefault, trình duyệt khỏi phải chờ
  const options = { capture: true, passive: true };
  target.addEventListener('pointerdown', handle, options);
  target.addEventListener('keydown', handle, options);
  return () => {
    target.removeEventListener('pointerdown', handle, options);
    target.removeEventListener('keydown', handle, options);
  };
}

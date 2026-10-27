/**
 * Báo tin mới trên tab trình duyệt khi người dùng đang ở tab/cửa sổ khác, theo ý tưởng của
 * Telegram Web A (components/main/Main.tsx): tiêu đề nhấp nháy "3 notifications" ↔ "Telegram",
 * favicon đổi sang bản có chấm đỏ.
 *
 * Kèm theo: hoãn xoá tin chưa thấy (api/gramjs/updater.ts), vì update "xoá" đôi khi tới trước update "tin mới".
 */

export interface UnreadIndicatorOptions {
  baseTitle: string;
  /** chu kỳ nhấp nháy, Telegram dùng 1000ms */
  interval?: number;
  setTitle?: (title: string) => void;
  /** null = favicon thường */
  setBadge?: (count: number | null) => void;
  label?: (n: number) => string;
}

/**
 * Đếm tin MỚI tới trong lúc người dùng vắng mặt. Bản gốc lấy
 * `tổng chưa đọc hiện tại - tổng chưa đọc lúc rời tab`; người dùng đọc vài tin trên điện thoại
 * thì hiệu số âm và tin mới không bao giờ được báo. Ở đây đếm thẳng từng tin tới.
 */
export function createUnreadIndicator({
  baseTitle,
  interval = 1000,
  setTitle = (t) => {
    // Gán document.title trùng giá trị vẫn tạo node mới (Telegram ghi chú: bộ đếm DOM Nodes của Chrome tăng)
    if (document.title !== t) document.title = t;
  },
  setBadge = () => {},
  label = (n) => `${n} tin nhắn mới`,
}: UnreadIndicatorOptions) {
  let away = false;
  let count = 0;
  let tick = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const stopBlink = () => {
    clearInterval(timer);
    timer = undefined;
  };

  const startBlink = () => {
    if (timer !== undefined) return;
    tick = 0;
    timer = setInterval(() => {
      if (count === 0) return;
      const showCount = tick++ % 2 === 0;
      setTitle(showCount ? label(count) : baseTitle);
      setBadge(showCount ? count : null);
    }, interval);
  };

  return {
    /** gọi khi tab ẩn / cửa sổ mất focus */
    leave() {
      // blur và visibilitychange có thể bắn liền nhau: chỉ reset ở lần rời đầu tiên
      if (away) return;
      away = true;
      count = 0;
    },
    /** gọi khi người dùng quay lại */
    back() {
      if (!away) return;
      away = false;
      count = 0;
      stopBlink();
      setTitle(baseTitle);
      setBadge(null);
    },
    /** gọi mỗi khi có tin mới (đã lọc chat bị tắt thông báo) */
    incoming(n = 1) {
      if (!away) return;
      count += n;
      startBlink();
    },
    get count() {
      return count;
    },
    get isAway() {
      return away;
    },
    destroy: stopBlink,
  };
}

/** Nối vào `visibilitychange` + `blur`/`focus` của cửa sổ. Trả về hàm gỡ. */
export function bindPageVisibility(indicator: { leave(): void; back(): void }) {
  const update = () => {
    if (document.visibilityState === 'hidden' || !document.hasFocus()) indicator.leave();
    else indicator.back();
  };
  const onBlur = () => indicator.leave();
  const onFocus = () => indicator.back();
  document.addEventListener('visibilitychange', update);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  return () => {
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
  };
}

/** Vẽ favicon có chấm đỏ kèm số bằng canvas, trả về data URL (Telegram đổi sang file favicon-unread có sẵn). */
export function drawBadgeFavicon(count: number | null, size = 32, base = '#2aabee') {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = base;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(size * 0.22, size * 0.5);
  ctx.lineTo(size * 0.75, size * 0.28);
  ctx.lineTo(size * 0.62, size * 0.74);
  ctx.closePath();
  ctx.fill();
  if (count) {
    const r = size * 0.3;
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(size - r, r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.round(r * 1.3)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(count > 9 ? '9+' : String(count), size - r, r + 1);
  }
  return c.toDataURL('image/png');
}

// ---------------------------------------------------------------- xoá tới trước tin mới

export interface MessageStore {
  has(id: number): boolean;
  add(id: number): void;
  remove(id: number): void;
}

/**
 * Update "xoá tin" tới cho một id chưa từng thấy: có thể tin đó chưa về (update lệch thứ tự).
 * Telegram hẹn 1 giây rồi phát lại lệnh xoá; tin về trễ hơn 1 giây thì vẫn hiện ra như "tin ma".
 * Ở đây giữ một danh sách "bia mộ" có hạn: tin nào về sau mà id nằm trong danh sách thì bỏ luôn.
 */
export function createDeleteBuffer(store: MessageStore, ttlMs = 60_000, now = () => Date.now()) {
  const tombstones = new Map<number, number>();

  const prune = () => {
    const t = now();
    for (const [id, expires] of tombstones) if (expires <= t) tombstones.delete(id);
  };

  return {
    onDelete(ids: number[]) {
      prune();
      for (const id of ids) {
        if (store.has(id)) store.remove(id);
        else tombstones.set(id, now() + ttlMs);
      }
    },
    /** trả về false nếu tin đã bị xoá từ trước khi tới */
    onNewMessage(id: number) {
      prune();
      if (tombstones.delete(id)) return false;
      store.add(id);
      return true;
    },
    get pending() {
      return tombstones.size;
    },
  };
}

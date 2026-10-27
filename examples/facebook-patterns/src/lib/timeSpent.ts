/**
 * Đo "thời gian thực sự dùng" bằng bitmap: mỗi giây có hoạt động bật một bit,
 * cả cửa sổ 64 giây nằm gọn trong 2 số 32-bit (ý tưởng từ TimeSpentArray,
 * CometTimeSpentEventListener và TimeSpentImmediateActiveSecondsLoggerComet của Facebook).
 */

export const WINDOW_SECONDS = 64; // 2 × 32 bit

export interface TimeSpentPayload {
  /** giây (unix) bắt đầu cửa sổ */
  start_time: number;
  /** 2 số 32-bit: bit i bật = giây start_time + i có hoạt động */
  tos_array: [number, number];
  /** cửa sổ dài bao nhiêu giây tính tới lúc gửi (≤ 64) */
  tos_len: number;
  /** số thứ tự cửa sổ trong phiên: 0, 1, 2… */
  tos_seq: number;
  /** tổng số giây hoạt động đã ghi trong phiên */
  tos_cum: number;
}

export interface WindowConfig {
  /** cửa sổ tự đóng sau bấy nhiêu giây kể từ lúc mở */
  timeoutSeconds: number;
  /** độ trễ cho phép khi gửi (đưa cho batch logger) */
  shipDelayMs: number;
}

/** Cấu hình thật của Facebook (TimeSpentWWWCometConfig): cửa sổ đầu 8s gửi ngay, sau đó 64s. */
export const FB_WINDOW_CONFIG = (seq: number): WindowConfig =>
  seq === 0 ? { timeoutSeconds: 8, shipDelayMs: 0 } : { timeoutSeconds: 64, shipDelayMs: 1000 };

export interface TimeSpentTrackerOptions {
  onShip: (payload: TimeSpentPayload, shipDelayMs: number) => void;
  windowConfig?: (seq: number) => WindowConfig;
  now?: () => number;
}

export function createTimeSpentTracker({ onShip, windowConfig = FB_WINDOW_CONFIG, now = Date.now }: TimeSpentTrackerOptions) {
  let bits: [number, number] | null = null;
  let startSecond = 0;
  let lastActivityMs = 0;
  let length = 0;
  let seq = -1;
  let cumulative = 0;
  let shipDelayMs = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();
  // ảnh chụp ổn định giữa các lần đổi (useSyncExternalStore cần cùng object nếu không có gì đổi)
  let cached: TimeSpentPayload | null = null;
  const notify = () => {
    cached = snapshot();
    listeners.forEach((l) => l());
  };

  function clearTimer() {
    if (timer != null) clearTimeout(timer);
    timer = null;
  }

  function snapshot(): TimeSpentPayload | null {
    if (!bits) return null;
    return { start_time: startSecond, tos_array: [bits[0], bits[1]], tos_len: length, tos_seq: seq, tos_cum: cumulative };
  }

  /** Đóng cửa sổ hiện tại và gửi đi (khi hết giờ, ra ngoài cửa sổ, đổi phiên, đóng tab). */
  function ship() {
    if (bits) {
      const t = now();
      // kéo dài tới "bây giờ" để server biết cửa sổ quan sát được bao lâu (các giây cuối là 0)
      if (t > lastActivityMs) length = Math.min(WINDOW_SECONDS, Math.ceil(t / 1000 - startSecond));
      onShip(snapshot()!, shipDelayMs);
    }
    clearTimer();
    bits = null;
    notify();
  }

  function openWindow(second: number) {
    startSecond = second;
    lastActivityMs = second * 1000;
    bits = [1, 0]; // giây đầu tiên của cửa sổ chính là giây có hoạt động
    length = 1;
    cumulative += 1;
    seq += 1;
    const config = windowConfig(seq);
    shipDelayMs = config.shipDelayMs;
    timer = setTimeout(ship, Math.min(config.timeoutSeconds, WINDOW_SECONDS) * 1000);
  }

  function recordSecond(second: number) {
    const offset = second - startSecond;
    if (bits && (offset < 0 || offset >= WINDOW_SECONDS)) ship(); // lệch khỏi cửa sổ (kể cả đồng hồ lùi)
    if (!bits) {
      openWindow(second);
    } else {
      // >>> 0 giữ số không âm khi bật bit 31
      bits[offset >> 5] = (bits[offset >> 5] | (1 << (offset & 31))) >>> 0;
      length = offset + 1;
      cumulative += 1;
      lastActivityMs = second * 1000;
    }
    notify();
  }

  return {
    /** Báo có hoạt động tại thời điểm `ms`. Nhiều sự kiện trong cùng một giây chỉ tính một lần. */
    update(ms = now()) {
      if (bits && ms >= lastActivityMs && ms - lastActivityMs < 1000) return;
      recordSecond(Math.floor(ms / 1000));
    },
    ship,
    get: () => cached,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    destroy() {
      clearTimer();
      listeners.clear();
    },
  };
}

export type TimeSpentTracker = ReturnType<typeof createTimeSpentTracker>;

/** Giải bitmap ra danh sách giây có hoạt động (để debug hoặc phía server). */
export function activeSeconds(p: Pick<TimeSpentPayload, 'tos_array' | 'tos_len'>): number[] {
  const out: number[] = [];
  for (let i = 0; i < p.tos_len; i++) if ((p.tos_array[i >> 5] >>> (i & 31)) & 1) out.push(i);
  return out;
}

/**
 * Nghe hoạt động của người dùng như CometTimeSpentEventListener:
 * click/focus/keydown báo ngay; mousemove/scroll throttle 500ms (leading).
 * Bỏ mousemove "giả": nội dung cuộn dưới con trỏ đứng yên vẫn bắn mouse event với cùng pageX/pageY.
 */
export function listenForActivity(onActivity: () => void, target: Window = window, throttleMs = 500) {
  let lastX: number | null = null;
  let lastY: number | null = null;
  let lastThrottled = -Infinity;
  const immediate = () => onActivity();
  const throttled = (event: Event) => {
    if (event instanceof MouseEvent && /^mouse(enter|leave|move|out|over)$/.test(event.type)) {
      if (event.pageX === lastX && event.pageY === lastY) return;
      lastX = event.pageX;
      lastY = event.pageY;
    }
    const t = performance.now();
    if (t - lastThrottled < throttleMs) return;
    lastThrottled = t;
    onActivity();
  };
  const opts = { capture: true, passive: true } as const;
  const immediateEvents = ['click', 'focus', 'keydown'] as const;
  const throttledEvents = ['mousemove', 'scroll', 'pointermove'] as const;
  immediateEvents.forEach((e) => target.addEventListener(e, immediate, opts));
  throttledEvents.forEach((e) => target.addEventListener(e, throttled, opts));
  return () => {
    immediateEvents.forEach((e) => target.removeEventListener(e, immediate, opts));
    throttledEvents.forEach((e) => target.removeEventListener(e, throttled, opts));
  };
}

// ---- Lấy mẫu "giây hoạt động" theo bucket cố định của từng user ----

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(text: string): number {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Mỗi user chỉ báo các giây có `floor(t/1000) % modulo === crc32(userId) % modulo`
 * (FB: modulo 2003, số nguyên tố). Không cần random: mỗi user lệch pha một cách ổn định,
 * cả hệ thống nhận mẫu rải đều theo thời gian, khoảng 1/2003 số giây của mỗi người.
 *
 * Khác bản gốc: FB viết `id !== "" || id !== "0"` (luôn đúng), nên mọi người chưa đăng nhập
 * (id "0") dùng chung một bucket và báo cùng một giây. Ở đây user ẩn danh không được lấy mẫu.
 */
export function createActiveSecondSampler(userId: string, modulo = 2003) {
  const enabled = userId !== '' && userId !== '0';
  const bucket = enabled ? crc32(userId) % modulo : -1;
  let lastSecond = -1;
  return {
    bucket,
    /** true nếu giây chứa `ms` là giây user này phải báo (mỗi giây tối đa một lần). */
    shouldReport(ms: number) {
      const second = Math.floor(ms / 1000);
      if (!enabled || second === lastSecond) return false;
      lastSecond = second;
      return second % modulo === bucket;
    },
  };
}

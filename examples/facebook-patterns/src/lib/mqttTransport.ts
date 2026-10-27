/**
 * Khi nào bỏ WebSocket để chuyển sang long-poll (ý tưởng từ MqttLongPollingRunner của Facebook),
 * và lịch thử lại (exponentialBackoff).
 */

export interface TransportState {
  /** trình duyệt có WebSocket không */
  wsSupported: boolean;
  /** WebSocket lỗi không thể cứu (vd: bị proxy/firewall chặn hẳn) */
  wsFatal: boolean;
  /** WebSocket đã từng kết nối thành công trong phiên này */
  wsConnected: boolean;
  /** số lần connect WebSocket thất bại */
  wsFailures: number;
  /** ms từ lúc bắt đầu thử kết nối */
  elapsedMs: number;
  /** phiên trước có phải dùng long-poll không (FB lưu cờ `last_lp`) */
  lastSessionUsedLongPoll: boolean;
}

export const FAST_DELAY_MS = 1000; // phiên trước đã phải long-poll: chờ WS 1s là đủ
export const REGULAR_DELAY_MS = 3000; // bình thường: cho WS 3s
export const MAX_WS_FAILURES = 3;

export type Decision = { longPoll: boolean; reason: string };

export function shouldLongPoll(s: TransportState): Decision {
  if (!s.wsSupported) return { longPoll: true, reason: 'không có WebSocket' };
  if (s.wsFatal) return { longPoll: true, reason: 'WebSocket lỗi fatal' };
  // đã chạy được WS thì không bao giờ tự lùi về long-poll
  if (s.wsConnected) return { longPoll: false, reason: 'WebSocket đã kết nối' };
  if (s.lastSessionUsedLongPoll) {
    if (s.wsFailures >= 1) return { longPoll: true, reason: 'phiên trước long-poll + WS lỗi 1 lần' };
    if (s.elapsedMs > FAST_DELAY_MS) return { longPoll: true, reason: `phiên trước long-poll + chờ WS > ${FAST_DELAY_MS}ms` };
  } else if (s.elapsedMs > REGULAR_DELAY_MS) {
    return { longPoll: true, reason: `chờ WS > ${REGULAR_DELAY_MS}ms` };
  }
  if (s.wsFailures >= MAX_WS_FAILURES) return { longPoll: true, reason: `WS lỗi ${MAX_WS_FAILURES} lần` };
  return { longPoll: false, reason: 'tiếp tục chờ WebSocket' };
}

/**
 * Độ trễ lần thử thứ `attempt` (0, 1, 2…) như exponentialBackoff của FB:
 * max(0, 2^min(n,6) · (1000 + random·100) − 2000) → 0; 0–0.2s; 2–2.4s; 6–6.8s; 14–15.6s; 30–33.2s; rồi trần 62–68.4s.
 * Hai lần đầu gần như thử lại ngay: lỗi mạng thoáng qua là chuyện thường.
 */
export function backoffDelay(attempt: number, random = Math.random) {
  return Math.max(0, 2 ** Math.min(attempt, 6) * (1000 + random() * 100) - 2000);
}

/** Lưu/đọc cờ "phiên trước phải long-poll" (FB: configWrite('last_lp', 'yes'|null)). */
export const lastSessionStore = {
  read(): boolean {
    try {
      return localStorage.getItem('mqtt:last_lp') === 'yes';
    } catch {
      return false;
    }
  },
  write(usedLongPoll: boolean) {
    try {
      if (usedLongPoll) localStorage.setItem('mqtt:last_lp', 'yes');
      else localStorage.removeItem('mqtt:last_lp'); // WS chạy được thì xoá cờ
    } catch {
      /* private mode: bỏ qua */
    }
  },
};

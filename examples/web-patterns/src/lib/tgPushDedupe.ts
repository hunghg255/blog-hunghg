/**
 * Thông báo không trùng giữa tab đang mở và service worker
 * (ý tưởng từ serviceWorker/pushNotification.ts + util/notifications.ts của Telegram Web A).
 *
 * Một tin nhắn mới có thể tới bằng HAI đường:
 *   1. tab đang mở nhận qua kết nối realtime → nhờ SW hiện thông báo (`newMessageNotification`)
 *   2. server gửi Web Push → SW tự hiện thông báo
 * Không xử lý thì người dùng thấy hai thông báo cho cùng một tin.
 *
 * Phần logic quyết định "hiện hay bỏ" được tách thành hàm thuần ở đây để chạy được trong
 * service worker thật lẫn trong demo (không cần server push).
 */

export interface IncomingNotification {
  messageId?: number;
  chatId?: number;
  title: string;
  body: string;
  muted?: boolean;
}

export type Decision =
  | { action: 'show'; tag?: string }
  | { action: 'drop'; reason: 'startup' | 'muted' | 'duplicate' };

export interface GateOptions {
  /** bỏ mọi push trong khoảng này sau khi SW khởi động (đống push tồn đọng lúc mở trình duyệt) */
  quietAfterStartMs?: number;
  /** nhớ id đã hiện trong bao lâu (bản gốc nhớ tới khi push trùng tới, không hết hạn) */
  rememberMs?: number;
  now?: () => number;
}

/** Bản gần với Telegram: chỉ đường "tab báo" ghi id, đường push xoá id khi gặp. */
export function createOriginalGate({ quietAfterStartMs = 3000, now = Date.now }: GateOptions = {}) {
  const startedAt = now();
  const shown = new Set<number | undefined>();
  return {
    fromTab(n: IncomingNotification): Decision {
      shown.add(n.messageId);
      return { action: 'show' };
    },
    fromPush(n: IncomingNotification): Decision {
      if (now() - startedAt < quietAfterStartMs) return { action: 'drop', reason: 'startup' };
      if (n.muted) return { action: 'drop', reason: 'muted' };
      if (shown.has(n.messageId)) {
        shown.delete(n.messageId);
        return { action: 'drop', reason: 'duplicate' };
      }
      return { action: 'show' };
    },
    size: () => shown.size,
  };
}

/**
 * Bản sửa:
 * - cả hai đường đều ghi id, đường tới SAU bị bỏ (bản gốc: push tới trước tab thì vẫn hiện 2 lần)
 * - id hết hạn sau `rememberMs` (bản gốc: tab báo mà push không bao giờ tới thì id nằm mãi)
 * - trả về `tag` theo messageId: dù lọt lưới, hệ điều hành cũng THAY thông báo cũ chứ không xếp chồng
 */
export function createNotificationGate({
  quietAfterStartMs = 3000,
  rememberMs = 60_000,
  now = Date.now,
}: GateOptions = {}) {
  const startedAt = now();
  const seen = new Map<number, number>(); // messageId -> thời điểm thấy

  const sweep = () => {
    const limit = now() - rememberMs;
    seen.forEach((at, id) => {
      if (at < limit) seen.delete(id);
    });
  };

  const decide = (n: IncomingNotification, source: 'tab' | 'push'): Decision => {
    sweep();
    if (source === 'push' && now() - startedAt < quietAfterStartMs) return { action: 'drop', reason: 'startup' };
    if (n.muted) return { action: 'drop', reason: 'muted' };
    if (n.messageId === undefined) return { action: 'show' };
    if (seen.has(n.messageId)) return { action: 'drop', reason: 'duplicate' };
    seen.set(n.messageId, now());
    return { action: 'show', tag: `msg-${n.chatId ?? 0}-${n.messageId}` };
  };

  return {
    fromTab: (n: IncomingNotification) => decide(n, 'tab'),
    fromPush: (n: IncomingNotification) => decide(n, 'push'),
    size: () => seen.size,
  };
}

/**
 * Chọn tab của app trong danh sách client của SW.
 * Bản gốc so sánh `client.url === registration.scope` (bằng tuyệt đối): tab đang ở
 * `/#/chat/123` hay `/?foo` bị coi như không có tab nào, nên bấm thông báo lại mở tab mới.
 */
export function findAppClients<T extends { url: string }>(clients: T[], scope: string) {
  return clients.filter((client) => client.url.startsWith(scope));
}

/**
 * Bộ đệm click: bấm thông báo khi chưa có tab → mở tab mới, giữ dữ liệu tới khi tab báo
 * `clientReady` rồi mới bảo nó nhảy tới tin nhắn.
 */
export function createClickBuffer<T>() {
  const pending = new Map<string, T>();
  return {
    hold(clientId: string, data: T) {
      pending.set(clientId, data);
    },
    /** gọi khi nhận `clientReady`; trả về dữ liệu cần xử lý (nếu có) và xoá khỏi bộ đệm */
    release(clientId: string) {
      const data = pending.get(clientId);
      pending.delete(clientId);
      return data;
    },
    size: () => pending.size,
  };
}

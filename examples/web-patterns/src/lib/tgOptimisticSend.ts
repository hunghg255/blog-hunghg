/**
 * Gửi tin nhắn lạc quan (ý tưởng từ Telegram Web A: api/gramjs/methods/messages.ts + updater.ts).
 *
 * - Tin hiện ngay với id tạm (>= 1e9, không bao giờ trùng id thật của server).
 * - Mỗi tin có một `randomId` ngẫu nhiên: vừa là khoá idempotency gửi lên server
 *   (gửi lại không tạo tin trùng), vừa là khoá để khớp xác nhận của server về đúng tin tạm.
 * - Icon "đang gửi" chỉ hiện nếu sau 1 giây server chưa xác nhận: mạng nhanh thì không nháy.
 * - Upload chạy song song ngay lập tức, nhưng lệnh gửi đi đúng thứ tự người dùng bấm.
 */

export type SendState = 'pending' | 'sent' | 'failed';

export interface OutgoingMessage {
  /** id hiển thị: id tạm lúc đầu, id thật sau khi server xác nhận */
  id: number;
  /** id tạm ban đầu, giữ lại để làm key ổn định cho UI (không remount khi đổi id) */
  localId: number;
  randomId: string;
  text: string;
  attachment?: { name: string; size: number };
  /** undefined = vừa tạo, chưa tới lúc hiện icon */
  state?: SendState;
  error?: string;
  /** tiến độ upload 0..1 */
  progress?: number;
}

export type SendUpdate =
  | { type: 'new'; message: OutgoingMessage }
  | { type: 'progress'; localId: number; progress: number }
  | { type: 'pending'; localId: number }
  | { type: 'succeeded'; localId: number; id: number }
  | { type: 'failed'; localId: number; error: string };

export interface SendTransport {
  /** tải file lên, trả về mã media để gắn vào lệnh gửi */
  upload(file: { name: string; size: number }, onProgress: (p: number) => void): Promise<string>;
  /** gửi tin; server dùng randomId để bỏ qua lệnh gửi trùng */
  send(req: { randomId: string; text: string; media?: string }): Promise<{ id: number }>;
}

export const LOCAL_ID_BASE = 1e9;

/** 8 byte ngẫu nhiên dạng hex (Telegram dùng bigint 64 bit). */
export function createRandomId() {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface MessageSenderOptions {
  transport: SendTransport;
  onUpdate: (update: SendUpdate) => void;
  /** chờ bao lâu mới hiện icon "đang gửi"; Telegram: FAST_SEND_TIMEOUT = 1000 */
  pendingDelayMs?: number;
  /** false = gửi ngay khi upload xong, không chờ tin trước (để so sánh trong demo) */
  keepOrder?: boolean;
}

export function createMessageSender({
  transport,
  onUpdate,
  pendingDelayMs = 1000,
  keepOrder = true,
}: MessageSenderOptions) {
  let localIdCounter = LOCAL_ID_BASE;
  // randomId -> tin tạm còn chờ xác nhận
  const unconfirmed = new Map<string, OutgoingMessage>();
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // chuỗi promise giữ thứ tự gửi; không bao giờ reject
  let queue: Promise<void> = Promise.resolve();

  /** Xác nhận từ server: qua response của lệnh gửi hoặc qua kênh realtime. Gọi nhiều lần vẫn an toàn. */
  function acknowledge(randomId: string, id: number) {
    const message = unconfirmed.get(randomId);
    if (!message) return; // đã xác nhận rồi
    unconfirmed.delete(randomId);
    clearTimeout(pendingTimers.get(randomId));
    pendingTimers.delete(randomId);
    onUpdate({ type: 'succeeded', localId: message.localId, id });
  }

  function fail(message: OutgoingMessage, error: unknown) {
    clearTimeout(pendingTimers.get(message.randomId));
    pendingTimers.delete(message.randomId);
    onUpdate({ type: 'failed', localId: message.localId, error: String((error as Error)?.message ?? error) });
  }

  function armPendingTimer(message: OutgoingMessage) {
    pendingTimers.set(
      message.randomId,
      setTimeout(() => {
        pendingTimers.delete(message.randomId);
        if (unconfirmed.has(message.randomId)) onUpdate({ type: 'pending', localId: message.localId });
      }, pendingDelayMs),
    );
  }

  function enqueue(message: OutgoingMessage, media: Promise<string | undefined>) {
    const prev = queue;
    const job = (async () => {
      let mediaId: string | undefined;
      try {
        mediaId = await media;
      } catch (error) {
        if (keepOrder) await prev;
        fail(message, error);
        return;
      }
      // upload đã chạy song song; tới đây mới chờ tin trước gửi xong
      if (keepOrder) await prev;
      try {
        const { id } = await transport.send({ randomId: message.randomId, text: message.text, media: mediaId });
        acknowledge(message.randomId, id);
      } catch (error) {
        // vẫn giữ trong `unconfirmed`: server có thể đã nhận, xác nhận có thể tới qua kênh realtime
        fail(message, error);
      }
    })();
    if (keepOrder) queue = job;
    return job;
  }

  function send(text: string, attachment?: { name: string; size: number }) {
    const localId = localIdCounter++;
    const message: OutgoingMessage = { id: localId, localId, randomId: createRandomId(), text, attachment };
    unconfirmed.set(message.randomId, message);
    onUpdate({ type: 'new', message });
    armPendingTimer(message);

    // upload bắt đầu NGAY, không chờ hàng đợi
    const media = attachment
      ? transport.upload(attachment, (progress) => onUpdate({ type: 'progress', localId, progress }))
      : Promise.resolve(undefined);
    media.catch(() => {}); // lỗi được xử lý trong enqueue
    return enqueue(message, media);
  }

  /** Gửi lại tin lỗi với CÙNG randomId: nếu lần trước server đã nhận thì không sinh tin trùng. */
  function retry(localId: number) {
    const message = [...unconfirmed.values()].find((m) => m.localId === localId);
    if (!message) return Promise.resolve();
    onUpdate({ type: 'pending', localId });
    const media = message.attachment
      ? transport.upload(message.attachment, (progress) => onUpdate({ type: 'progress', localId, progress }))
      : Promise.resolve(undefined);
    media.catch(() => {});
    return enqueue(message, media);
  }

  function destroy() {
    pendingTimers.forEach(clearTimeout);
    pendingTimers.clear();
  }

  return { send, retry, acknowledge, destroy };
}

export type MessageSender = ReturnType<typeof createMessageSender>;

/** Reducer nhỏ cho danh sách tin, dùng chung cho demo và test. */
export function applySendUpdate(list: OutgoingMessage[], update: SendUpdate): OutgoingMessage[] {
  switch (update.type) {
    case 'new':
      return [...list, update.message];
    case 'progress':
      return list.map((m) => (m.localId === update.localId ? { ...m, progress: update.progress } : m));
    case 'pending':
      return list.map((m) => (m.localId === update.localId && m.state !== 'sent' ? { ...m, state: 'pending', error: undefined } : m));
    case 'succeeded':
      return list.map((m) => (m.localId === update.localId ? { ...m, id: update.id, state: 'sent', error: undefined } : m));
    case 'failed':
      return list.map((m) => (m.localId === update.localId ? { ...m, state: 'failed', error: update.error } : m));
    default:
      return list;
  }
}

/**
 * Hàng đợi gửi tin nhắn chat giữ đúng thứ tự.
 *
 * Ý tưởng từ MercuryServerSendMessageQueue (Messenger trên facebook.com):
 * - Mỗi lúc chỉ có MỘT tin đang bay; tin sau chỉ được gửi khi tin trước đã có phản hồi.
 * - Trong lúc gửi, tạm dừng xử lý "delta" đồng bộ từ server, để bản vọng lại của chính tin
 *   vừa gửi không tới trước phản hồi và bị hiện thành tin thứ hai.
 * - Tin đang bay lỗi (lỗi server, lỗi mạng, timeout) thì MỌI tin còn trong hàng đợi cũng bị
 *   đánh dấu lỗi: gửi tiếp các tin sau sẽ làm đảo thứ tự cuộc trò chuyện.
 * - Còn tin chưa gửi mà người dùng đóng tab thì hỏi lại (beforeunload).
 */

export type FailReason = 'error' | 'timeout' | 'cascade';

export interface SendQueueOptions<M, R> {
  send: (message: M, signal: AbortSignal) => Promise<R>;
  /** FB đặt timeout cho từng request; hết giờ thì coi như lỗi */
  timeoutMs?: number;
  onSent?: (message: M, result: R) => void;
  onFailed?: (message: M, reason: FailReason, error?: unknown) => void;
  /** tạm dừng / chạy lại luồng đồng bộ trong lúc có tin đang bay */
  sync?: { pause(): void; resume(): void };
}

export interface SendQueue<M> {
  enqueue(message: M): void;
  /** gửi lại các tin đã lỗi, đúng thứ tự cũ */
  retryFailed(): void;
  hasUnsent(): boolean;
  snapshot(): { inFlight: M | null; queued: M[]; failed: M[] };
  destroy(): void;
}

export class SendTimeoutError extends Error {
  constructor(ms: number) {
    super(`Không có phản hồi sau ${ms}ms`);
  }
}

export function createSendQueue<M, R>(options: SendQueueOptions<M, R>): SendQueue<M> {
  const { send, timeoutMs = 15_000, onSent, onFailed, sync } = options;
  const queue: M[] = [];
  const failed: M[] = [];
  let inFlight: M | null = null;
  let controller: AbortController | null = null;
  let destroyed = false;

  function failRest() {
    // giữ thứ tự: các tin sau tin lỗi xếp tiếp vào danh sách lỗi, không gửi vượt lên trước
    while (queue.length > 0) {
      const message = queue.shift()!;
      failed.push(message);
      onFailed?.(message, 'cascade');
    }
  }

  async function pump() {
    if (destroyed || inFlight != null || queue.length === 0) return;
    const message = queue.shift()!;
    inFlight = message;
    controller = new AbortController();
    const { signal } = controller;
    sync?.pause();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let outcome: { ok: true; result: R } | { ok: false; error: unknown };
    try {
      const result = await Promise.race([
        send(message, signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller?.abort();
            reject(new SendTimeoutError(timeoutMs));
          }, timeoutMs);
        }),
      ]);
      outcome = { ok: true, result };
    } catch (error) {
      outcome = { ok: false, error };
    }
    clearTimeout(timer);
    inFlight = null;
    if (destroyed) return;
    if (outcome.ok) {
      // callback của app lỗi thì không được coi là tin gửi lỗi (server đã nhận rồi)
      try {
        onSent?.(message, outcome.result);
      } finally {
        sync?.resume();
        void pump();
      }
      return;
    }
    failed.push(message);
    onFailed?.(message, outcome.error instanceof SendTimeoutError ? 'timeout' : 'error', outcome.error);
    sync?.resume();
    failRest();
  }

  return {
    enqueue(message) {
      queue.push(message);
      void pump();
    },
    retryFailed() {
      // tin lỗi gửi lại TRƯỚC các tin mới gõ thêm sau đó
      queue.unshift(...failed.splice(0));
      void pump();
    },
    hasUnsent: () => inFlight != null || queue.length > 0,
    snapshot: () => ({ inFlight, queued: [...queue], failed: [...failed] }),
    destroy() {
      destroyed = true;
      controller?.abort();
      queue.length = 0;
    },
  };
}

/**
 * Luồng đồng bộ có thể tạm dừng: delta tới lúc đang dừng được giữ lại, chạy lại thì áp dụng
 * theo đúng thứ tự. Đếm số lần pause để lồng nhau vẫn an toàn.
 */
export function createPausableSync<D>(apply: (delta: D) => void) {
  let pauses = 0;
  const buffer: D[] = [];
  return {
    push(delta: D) {
      if (pauses > 0) buffer.push(delta);
      else apply(delta);
    },
    pause() {
      pauses++;
    },
    resume() {
      pauses = Math.max(0, pauses - 1);
      while (pauses === 0 && buffer.length > 0) apply(buffer.shift()!);
    },
    isPaused: () => pauses > 0,
    buffered: () => buffer.length,
  };
}

/** Hỏi lại trước khi đóng tab nếu còn tin chưa gửi (Run.onBeforeUnload ở bản gốc). */
export function guardUnsentOnUnload(queue: Pick<SendQueue<unknown>, 'hasUnsent'>) {
  const onBeforeUnload = (event: BeforeUnloadEvent) => {
    if (!queue.hasUnsent()) return;
    event.preventDefault();
    // trình duyệt cũ cần returnValue; nội dung chuỗi không còn được hiển thị
    event.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}

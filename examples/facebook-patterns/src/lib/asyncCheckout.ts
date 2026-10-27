/**
 * Thanh toán bất đồng bộ: kết quả có thể đến từ 4 nguồn, nguồn nào đến trước thì thắng
 * (ý tưởng từ FBPaymentsAsyncCompleteCheckoutManager của Facebook).
 *
 * 1. Chưa có payment session thì tạo trước (dùng làm khoá idempotent cho lần charge).
 * 2. MỞ SUBSCRIPTION TRƯỚC rồi mới gọi charge, để không lỡ sự kiện "success" đến sớm.
 * 3. Charge trả success/failure: xong. Trả in_progress: sau `pollTimeMs` bắt đầu hỏi trạng thái
 *    mỗi `pollTimeRetryMs`, và hẹn timeout tổng `timeoutMs`. Server được ghi đè 3 số này.
 * 4. Kết quả đầu tiên thắng; sau đó huỷ subscription và mọi timer.
 */

export type PaymentStatus = 'success' | 'failure' | 'in_progress';

export interface AsyncMetadata {
  pollTimeMs?: number;
  pollTimeRetryMs?: number;
  timeoutMs?: number;
}

export interface ChargeResponse {
  status: PaymentStatus;
  error?: string;
  asyncMetadata?: AsyncMetadata;
}

export interface StatusResponse {
  status: PaymentStatus;
  error?: string;
}

export interface CheckoutApi {
  createSession(): Promise<string>;
  /** sessionId đóng vai khoá idempotent: gọi lại với cùng session không trừ tiền hai lần */
  charge(sessionId: string): Promise<ChargeResponse>;
  queryStatus(sessionId: string): Promise<StatusResponse>;
  /** trả hàm huỷ đăng ký */
  subscribe(sessionId: string, onUpdate: (update: StatusResponse) => void): () => void;
}

export type OutcomeSource = 'session' | 'charge' | 'subscription' | 'polling' | 'timeout';

export interface CheckoutOutcome {
  status: 'success' | 'failure';
  source: OutcomeSource;
  error?: string;
  sessionId?: string;
}

export interface CheckoutEvent {
  source: OutcomeSource;
  /** ms kể từ lúc bắt đầu */
  at: number;
  text: string;
}

export interface AsyncCheckoutOptions extends AsyncMetadata {
  /**
   * 'chain' (mặc định): hỏi trạng thái xong lần này mới hẹn lần sau, không chồng request.
   * 'interval': setInterval như bản gốc; query chậm hơn chu kỳ thì chồng lên nhau.
   */
  pollMode?: 'chain' | 'interval';
  /** chỉ để minh hoạ lỗi: gọi charge trước rồi mới subscribe */
  subscribeAfterCharge?: boolean;
  onEvent?: (event: CheckoutEvent) => void;
  now?: () => number;
}

export const DEFAULTS = { pollTimeMs: 10_000, pollTimeRetryMs: 3_000, timeoutMs: 120_000 };

export function runAsyncCheckout(
  api: CheckoutApi,
  sessionIdIn: string | null,
  {
    pollMode = 'chain',
    subscribeAfterCharge = false,
    onEvent,
    now = () => performance.now(),
    ...overrides
  }: AsyncCheckoutOptions = {},
): { promise: Promise<CheckoutOutcome>; cancel: () => void } {
  const startedAt = now();
  const emit = (source: OutcomeSource, text: string) =>
    onEvent?.({ source, at: Math.round(now() - startedAt), text });

  // Mọi trạng thái nằm trong closure của LẦN CHẠY NÀY. Bản gốc giữ timer trên instance và
  // makeAsyncPayment() chỉ reset cờ settled: gọi lần 2 khi lần 1 chưa xong thì timer của lần 1
  // mất handle, vẫn có thể bắn timeout vào lần 2.
  let settled = false;
  let unsubscribe: (() => void) | null = null;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let resolveOutcome!: (o: CheckoutOutcome) => void;
  const promise = new Promise<CheckoutOutcome>((r) => (resolveOutcome = r));
  let sessionId: string | null = sessionIdIn;

  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const cleanup = () => {
    unsubscribe?.();
    unsubscribe = null;
    timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    timers.clear();
  };
  const finish = (outcome: CheckoutOutcome) => {
    if (settled) return; // kết quả đầu tiên thắng
    settled = true;
    cleanup();
    emit(
      outcome.source,
      `KẾT THÚC: ${outcome.status}${outcome.error ? ` (${outcome.error})` : ''}`,
    );
    resolveOutcome({ ...outcome, sessionId: sessionId ?? undefined });
  };

  const onStatus = (source: 'subscription' | 'polling') => (update: StatusResponse) => {
    if (settled) return;
    emit(source, `trạng thái: ${update.status}`);
    // in_progress chỉ là "chưa xong", không phải lỗi
    if (update.status === 'success') finish({ status: 'success', source });
    else if (update.status === 'failure')
      finish({ status: 'failure', source, error: update.error });
  };

  const startPolling = (retryMs: number) => {
    const poll = async () => {
      if (settled) return;
      emit('polling', 'hỏi trạng thái…');
      try {
        onStatus('polling')(await api.queryStatus(sessionId!));
      } catch (error) {
        // lỗi mạng lúc poll: bỏ qua, còn lượt sau và còn timeout tổng
        emit('polling', `lỗi khi hỏi: ${String(error)}`);
      }
      if (pollMode === 'chain' && !settled) later(retryMs, poll);
    };
    if (pollMode === 'interval') {
      void poll();
      const id = setInterval(() => void poll(), retryMs);
      timers.add(id);
    } else {
      void poll();
    }
  };

  const subscribe = () => {
    emit('subscription', 'mở subscription');
    unsubscribe = api.subscribe(sessionId!, onStatus('subscription'));
  };

  (async () => {
    try {
      if (!sessionId) {
        emit('session', 'tạo payment session…');
        sessionId = await api.createSession();
        emit('session', `session = ${sessionId}`);
      }
      if (settled) return;
      if (!subscribeAfterCharge) subscribe();
      emit('charge', 'gọi charge…');
      const charge = api.charge(sessionId);
      if (subscribeAfterCharge) {
        // chỉ để minh hoạ: subscription mở muộn, sự kiện đến trước đó bị lỡ
        await new Promise((r) => setTimeout(r, 0));
        await charge.catch(() => undefined);
        subscribe();
      }
      const res = await charge;
      if (settled) return;
      emit('charge', `charge trả: ${res.status}`);
      if (res.status === 'success') return finish({ status: 'success', source: 'charge' });
      if (res.status === 'failure')
        return finish({ status: 'failure', source: 'charge', error: res.error });
      const pollTimeMs =
        res.asyncMetadata?.pollTimeMs ?? overrides.pollTimeMs ?? DEFAULTS.pollTimeMs;
      const retryMs =
        res.asyncMetadata?.pollTimeRetryMs ?? overrides.pollTimeRetryMs ?? DEFAULTS.pollTimeRetryMs;
      const timeoutMs = res.asyncMetadata?.timeoutMs ?? overrides.timeoutMs ?? DEFAULTS.timeoutMs;
      later(pollTimeMs, () => startPolling(retryMs));
      later(timeoutMs, () =>
        finish({ status: 'failure', source: 'timeout', error: 'quá thời gian chờ' }),
      );
    } catch (error) {
      finish({ status: 'failure', source: sessionId ? 'charge' : 'session', error: String(error) });
    }
  })();

  return {
    promise,
    cancel: () => finish({ status: 'failure', source: 'charge', error: 'đã huỷ' }),
  };
}

/**
 * Hai cách giữ dữ liệu không mất trên kết nối chập chờn, học từ MqttChannel và CVCv3SubscriptionHelper:
 * 1. QoS1 (at-least-once): mỗi publish có token, nằm trong hàng chờ tới khi có ack;
 *    gửi lỗi thì im lặng chờ kết nối lại rồi phát lại; quá hạn thì reject.
 * 2. Heartbeat trạng thái tuyệt đối: mỗi gói mang tổng đã xem của đoạn hiện tại (không phải phần tăng thêm)
 *    kèm trạng thái gói trước, nên mất gói không mất dữ liệu và server phát hiện được chỗ hổng.
 * Khác bản gốc: token đi kèm gói để server khử trùng, phát lại một lần cho mỗi lần kết nối,
 * báo trạng thái từng message, đồng hồ và timer tiêm vào được.
 */

// ───────────────────────── 1. QoS1 ─────────────────────────

export interface OutPacket {
  token: string;
  topic: string;
  payload: string;
  qos: 0 | 1;
  /** lần gửi thứ mấy (1 = lần đầu, >1 = phát lại) */
  attempt: number;
}

export interface Qos1Transport {
  /** gửi một gói; trả false hoặc ném lỗi nếu chưa gửi được (đang mất kết nối) */
  send(packet: OutPacket): boolean;
}

export type PublishState = 'queued' | 'sent' | 'acked' | 'timeout' | 'failed';

export interface Qos1Options {
  transport: Qos1Transport;
  /** hạn chót tính từ lúc publish, không reset khi phát lại (bản gốc: 60 giây) */
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  newToken?: () => string;
  onState?: (token: string, state: PublishState, packet: OutPacket) => void;
}

export interface Qos1Channel {
  publish(topic: string, payload: string, qos?: 0 | 1): { token: string; done: Promise<void> };
  /** server xác nhận đã nhận gói có token này (PUBACK) */
  ack(token: string): void;
  /** đổi trạng thái kết nối; khi nối lại thì phát lại mọi gói đang chờ ack */
  setConnected(connected: boolean): void;
  readonly connected: boolean;
  /** các gói đang chờ ack */
  pending(): OutPacket[];
  /** huỷ hết, reject mọi gói đang chờ */
  dispose(reason?: string): void;
}

interface Entry {
  packet: OutPacket;
  timer: unknown;
  resolve: () => void;
  reject: (e: Error) => void;
}

let tokenSeq = 0;

export function createQos1Channel(options: Qos1Options): Qos1Channel {
  const {
    transport,
    timeoutMs = 60_000,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    newToken = () => `${Date.now().toString(36)}-${(tokenSeq++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    onState,
  } = options;
  const waiting = new Map<string, Entry>();
  let connected = false;

  const trySend = (packet: OutPacket) => {
    if (!connected) return false;
    try {
      return transport.send(packet) !== false;
    } catch {
      return false;
    }
  };

  const settle = (token: string) => {
    const entry = waiting.get(token);
    if (!entry) return null;
    clearTimer(entry.timer);
    waiting.delete(token);
    return entry;
  };

  const channel: Qos1Channel = {
    publish(topic, payload, qos = 1) {
      const packet: OutPacket = { token: newToken(), topic, payload, qos, attempt: 1 };
      if (qos === 0) {
        // QoS0: gửi được thì xong, không được thì báo lỗi ngay, không giữ lại
        const ok = trySend(packet);
        onState?.(packet.token, ok ? 'sent' : 'failed', packet);
        return { token: packet.token, done: ok ? Promise.resolve() : Promise.reject(new Error('Not connected')) };
      }
      const done = new Promise<void>((resolve, reject) => {
        const timer = setTimer(() => {
          const entry = settle(packet.token);
          if (!entry) return;
          onState?.(packet.token, 'timeout', packet);
          entry.reject(new Error('Publish Timed Out'));
        }, timeoutMs);
        waiting.set(packet.token, { packet, timer, resolve, reject });
      });
      onState?.(packet.token, 'queued', packet);
      // gửi lỗi thì không reject: gói nằm chờ lần kết nối sau (giống bản gốc)
      if (trySend(packet)) onState?.(packet.token, 'sent', packet);
      return { token: packet.token, done };
    },
    ack(token) {
      const entry = settle(token);
      if (!entry) return; // ack trùng hoặc tới sau khi đã timeout: bỏ qua
      onState?.(token, 'acked', entry.packet);
      entry.resolve();
    },
    setConnected(next) {
      const wasConnected = connected;
      connected = next;
      if (!next || wasConnected) return;
      // vừa nối lại: phát lại một lần mọi gói chưa có ack, theo thứ tự publish
      for (const entry of waiting.values()) {
        entry.packet = { ...entry.packet, attempt: entry.packet.attempt + 1 };
        if (trySend(entry.packet)) onState?.(entry.packet.token, 'sent', entry.packet);
      }
    },
    get connected() {
      return connected;
    },
    pending() {
      return [...waiting.values()].map((e) => e.packet);
    },
    dispose(reason = 'Channel closed') {
      for (const token of [...waiting.keys()]) settle(token)?.reject(new Error(reason));
    },
  };
  return channel;
}

/** Phía nhận: nhớ N token gần nhất để bỏ gói phát lại trùng (at-least-once → xử lý đúng một lần). */
export function createDedupe(capacity = 1000) {
  const seen = new Set<string>();
  return {
    /** true nếu token mới (cần xử lý), false nếu đã thấy */
    accept(token: string) {
      if (seen.has(token)) return false;
      seen.add(token);
      if (seen.size > capacity) seen.delete(seen.values().next().value!);
      return true;
    },
    get size() {
      return seen.size;
    },
  };
}

// ───────────────────────── 2. Heartbeat trạng thái tuyệt đối ─────────────────────────

export interface SpanState {
  /** vị trí bắt đầu đoạn phát liên tục, ms (bản gốc: sa) */
  startMs: number;
  /** đã phát bao lâu trong đoạn này, ms (bản gốc: pf) */
  playedMs: number;
  state: 'playing' | 'paused' | 'ended' | 'unknown';
  muted: boolean;
}

export interface WatchUpdate {
  videoId: string;
  /** id phiên xem (bản gốc: si = guid) */
  session: string;
  /** số thứ tự gói trong phiên, để server thấy chỗ hổng ngay cả khi không có prev */
  seq: number;
  /** trạng thái hiện tại (bản gốc: ps) */
  current: SpanState | null;
  /** trạng thái đã gửi ở gói trước (bản gốc: pps) */
  previous: SpanState | null;
  /** token server trả ở lần trước, gửi lại nguyên vẹn (bản gốc: tk) */
  token?: string;
}

export function createWatchReporter(videoId: string, session = Math.random().toString(36).slice(2)) {
  let previous: SpanState | null = null;
  let token: string | undefined;
  let seq = 0;
  return {
    /** startSec/positionSec: vị trí lúc bắt đầu đoạn và vị trí hiện tại (giây, như video.currentTime) */
    makeUpdate(startSec: number, positionSec: number, state: SpanState['state'], muted: boolean): WatchUpdate {
      const valid = Number.isFinite(startSec) && Number.isFinite(positionSec);
      const current: SpanState | null = valid
        ? { startMs: Math.floor(startSec * 1000), playedMs: Math.max(0, Math.floor((positionSec - startSec) * 1000)), state, muted }
        : null;
      const update: WatchUpdate = { videoId, session, seq: seq++, current, previous, token };
      // ghi nhớ ngay cả khi gói này rồi bị mất: gói sau vẫn khai "trước đó tôi đã gửi X"
      previous = current;
      return update;
    },
    /** server trả token mới (và có thể nhịp gửi mới) */
    handleResponse(response: { token?: string }) {
      if (response.token) token = response.token;
    },
    /** dừng phát: đoạn sau là đoạn mới, không nối với đoạn cũ */
    resetSpan() {
      previous = null;
    },
  };
}

/**
 * Phía server: cộng thời gian xem từ các gói nhận được.
 * Mỗi đoạn (session + startMs) lấy playedMs lớn nhất đã thấy: gói mất ở giữa đoạn không làm mất gì,
 * chỉ phần đuôi sau gói cuối cùng nhận được của đoạn là mất.
 * `previous` của gói sau cho biết client đã gửi gì trước đó; khác cái server thấy = có gói mất.
 */
export function totalWatchedMs(received: WatchUpdate[]) {
  const best = new Map<string, number>();
  const lastSeen = new Map<string, number | null>(); // session → playedMs của gói gần nhất nhận được
  let gaps = 0;
  for (const u of [...received].sort((a, b) => a.seq - b.seq)) {
    const prevSeen = lastSeen.get(u.session) ?? null;
    if (u.previous && prevSeen !== u.previous.playedMs) gaps++;
    if (u.current) {
      const key = `${u.session}:${u.current.startMs}`;
      best.set(key, Math.max(best.get(key) ?? 0, u.current.playedMs));
    }
    lastSeen.set(u.session, u.current?.playedMs ?? null);
  }
  let totalMs = 0;
  for (const v of best.values()) totalMs += v;
  return { totalMs, spans: best.size, gaps };
}

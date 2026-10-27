/**
 * MÔ PHỎNG hành vi của tracker/sender.ts (Udemy) để so sánh trong demo, không phải mã gốc:
 * - preventOverlappingCall: cờ `awaiting` chỉ được hạ khi hàm KHÔNG ném lỗi;
 * - 207 đọc thẳng response.data.failedEvents và events[idx].eventData;
 * - tab ẩn: beacon cả lô đang bay lẫn hàng đợi (lô đang bay vẫn tiếp tục gửi thường);
 * - beacon gửi một payload duy nhất.
 */
import type { EventStatus, TrackEvent, Transport } from '../lib/udTracker';

export function createUdemyStyleTracker(opts: {
  endpoint: string;
  transport: Transport;
  onStatus: (e: TrackEvent, s: EventStatus, reason?: string) => void;
  flushInterval?: number;
  retryGap?: number;
}) {
  const queue: TrackEvent[] = [];
  let eventsInFlight: TrackEvent[] = [];
  let awaiting = false;
  let seq = 0;

  async function _flush() {
    eventsInFlight = queue.splice(0, queue.length);
    if (!eventsInFlight.length) return;
    let response = null;
    try {
      // makeRetryingFunction(send, 3, retryGap, chỉ 5xx/lỗi mạng): tổng cộng 3 lần thử
      for (let i = 0; ; i++) {
        try {
          response = await opts.transport.post(opts.endpoint, JSON.stringify(eventsInFlight));
          if (response.status >= 400) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
          break;
        } catch (e) {
          const status = (e as { status?: number }).status;
          const retry = !status || (status >= 500 && status <= 599);
          if (i + 1 >= 3 || !retry) throw e;
          await new Promise((r) => setTimeout(r, opts.retryGap ?? 3000));
        }
      }
    } catch (e) {
      eventsInFlight.forEach((ev) => opts.onStatus(ev, 'failed', String(e)));
      response = null;
    }
    if (response?.status === 200) eventsInFlight.forEach((ev) => opts.onStatus(ev, 'sent'));
    if (response?.status === 207) {
      const body = response.body as { failedEvents: { idx: number; reason: string }[] };
      const failed = new Set<TrackEvent>();
      body.failedEvents.forEach((f) => {
        const ev = eventsInFlight[f.idx];
        opts.onStatus(ev, 'rejected', f.reason);
        failed.add(ev);
      });
      eventsInFlight.filter((ev) => !failed.has(ev)).forEach((ev) => opts.onStatus(ev, 'sent'));
    }
    eventsInFlight = [];
  }

  async function flush() {
    if (awaiting) return;
    awaiting = true;
    await _flush(); // ném lỗi ở đây thì dòng dưới không chạy: awaiting kẹt true mãi
    awaiting = false;
  }

  const timer = setInterval(() => void flush().catch(() => {}), opts.flushInterval ?? 3000);

  return {
    track(type: string, data?: Record<string, unknown>) {
      const event = { id: `u${seq++}`, type, data, clientTime: Date.now() };
      queue.push(event);
      return event;
    },
    flush: () => flush().catch(() => {}),
    onHidden() {
      const events = [...eventsInFlight, ...queue.splice(0, queue.length)];
      if (!events.length) return;
      const ok = opts.transport.beacon(opts.endpoint, JSON.stringify(events));
      events.forEach((ev) => opts.onStatus(ev, ok ? 'beacon' : 'failed'));
    },
    get queueSize() {
      return queue.length;
    },
    get isStuck() {
      return awaiting;
    },
    destroy() {
      clearInterval(timer);
    },
  };
}

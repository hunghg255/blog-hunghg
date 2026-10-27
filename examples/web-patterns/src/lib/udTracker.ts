/**
 * Pipeline gửi sự kiện tracking, ý tưởng từ tracker/sender.ts của Udemy, viết lại với các sửa lỗi:
 * - gom theo lô 3 giây (lô đầu sau 250ms), không chồng hai lần gửi; khoá luôn được mở trong `finally`;
 * - HTTP 207: chỉ sự kiện server từ chối mới bị đánh dấu lỗi, đọc body phòng thủ;
 * - chỉ thử lại khi lỗi mạng, 5xx hoặc 429, cách nhau `retryGap`;
 * - tab ẩn: beacon phần còn trong hàng đợi (KHÔNG gửi lại lô đang bay → không nhân đôi);
 *   pagehide: beacon cả lô đang bay vì request thường sẽ bị huỷ; pageshow từ bfcache: mở lại;
 * - beacon chia nhỏ dưới giới hạn ~64KB; mỗi sự kiện có id để server bỏ trùng.
 */

export interface TrackEvent {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  clientTime: number;
  sendTime?: number;
}

export type EventStatus = 'sent' | 'beacon' | 'rejected' | 'failed';

export interface TransportResponse {
  status: number;
  body?: unknown;
}

export interface Transport {
  /** reject (ném lỗi không có status) khi lỗi mạng */
  post(url: string, body: string): Promise<TransportResponse>;
  beacon(url: string, body: string): boolean;
}

export interface TrackerOptions {
  endpoint: string;
  transport: Transport;
  flushInterval?: number;
  initialDelay?: number;
  /** số lần thử lại SAU lần gửi đầu */
  retries?: number;
  retryGap?: number;
  beaconMaxBytes?: number;
  onStatus?: (event: TrackEvent, status: EventStatus, reason?: string) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

const retryable = (e: unknown) =>
  !(e instanceof HttpError) || e.status >= 500 || e.status === 429;

/** Đọc body của 207: chỉ tin những idx hợp lệ, phần còn lại coi như thành công. */
export function parsePartialFailures(body: unknown, count: number): Map<number, string> {
  const failed = new Map<number, string>();
  const list = (body as { failedEvents?: unknown })?.failedEvents;
  if (!Array.isArray(list)) return failed;
  for (const item of list) {
    const idx = (item as { idx?: unknown })?.idx;
    if (Number.isInteger(idx) && (idx as number) >= 0 && (idx as number) < count) {
      failed.set(idx as number, String((item as { reason?: unknown }).reason ?? 'rejected'));
    }
  }
  return failed;
}

/** Chia mảng sự kiện thành các payload JSON không vượt `maxBytes` (tính theo UTF-8). */
export function splitForBeacon(events: TrackEvent[], maxBytes: number): string[] {
  const enc = new TextEncoder();
  const payloads: string[] = [];
  let current: TrackEvent[] = [];
  let size = 2; // "[]"
  for (const e of events) {
    const n = enc.encode(JSON.stringify(e)).length + 1;
    if (current.length && size + n > maxBytes) {
      payloads.push(JSON.stringify(current));
      current = [];
      size = 2;
    }
    current.push(e);
    size += n;
  }
  if (current.length) payloads.push(JSON.stringify(current));
  return payloads;
}

export function createTracker(options: TrackerOptions) {
  const {
    endpoint,
    transport,
    flushInterval = 3000,
    initialDelay = 250,
    retries = 2,
    retryGap = 3000,
    beaconMaxBytes = 60_000,
    onStatus = () => {},
  } = options;

  const queue: TrackEvent[] = [];
  let inFlight: TrackEvent[] = [];
  let flushing: Promise<void> | null = null;
  let closed = false;

  async function postWithRetry(body: string) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await transport.post(endpoint, body);
        if (res.status >= 400) throw new HttpError(res.status);
        return res;
      } catch (e) {
        if (attempt >= retries || !retryable(e)) throw e;
        await sleep(retryGap);
      }
    }
  }

  async function doFlush() {
    const batch = queue.splice(0, queue.length);
    if (!batch.length) return;
    const now = Date.now();
    batch.forEach((e) => (e.sendTime = now));
    inFlight = batch;
    try {
      const res = await postWithRetry(JSON.stringify(batch));
      if (inFlight !== batch) return; // lô này đã được beacon lúc pagehide
      const failed = res.status === 207 ? parsePartialFailures(res.body, batch.length) : new Map();
      batch.forEach((e, i) =>
        failed.has(i) ? onStatus(e, 'rejected', failed.get(i)) : onStatus(e, 'sent'),
      );
    } catch (e) {
      if (inFlight !== batch) return;
      const reason = e instanceof Error ? e.message : String(e);
      batch.forEach((ev) => onStatus(ev, e instanceof HttpError && !retryable(e) ? 'rejected' : 'failed', reason));
    } finally {
      if (inFlight === batch) inFlight = [];
    }
  }

  /** Không chạy chồng: đang gửi thì trả về chính promise đó. Khoá tự mở kể cả khi có lỗi. */
  function flush(): Promise<void> {
    if (closed) return Promise.resolve();
    flushing ??= doFlush().finally(() => {
      flushing = null;
    });
    return flushing;
  }

  function sendBeacon(events: TrackEvent[]) {
    if (!events.length) return;
    for (const payload of splitForBeacon(events, beaconMaxBytes)) {
      const part: TrackEvent[] = JSON.parse(payload);
      const ok = transport.beacon(endpoint, payload);
      const ids = new Set(part.map((e) => e.id));
      events.filter((e) => ids.has(e.id)).forEach((e) => onStatus(e, ok ? 'beacon' : 'failed', ok ? undefined : 'beacon bị từ chối'));
    }
  }

  const timer = setInterval(() => void flush(), flushInterval);
  const firstTimer = setTimeout(() => void flush(), initialDelay);

  return {
    track(type: string, data?: Record<string, unknown>) {
      const event: TrackEvent = { id: newId(), type, data, clientTime: Date.now() };
      queue.push(event);
      return event;
    },
    flush,
    /** visibilitychange → hidden: tab có thể bị đóng mà không có pagehide (mobile). */
    onHidden() {
      sendBeacon(queue.splice(0, queue.length));
    },
    /** pagehide: request đang bay sẽ bị huỷ nên gửi cả lô đó qua beacon (server bỏ trùng theo id). */
    onPageHide() {
      closed = true;
      const events = [...inFlight, ...queue.splice(0, queue.length)];
      inFlight = [];
      sendBeacon(events);
    },
    /** pageshow với persisted = true: trang được khôi phục từ bfcache. */
    onPageShow(persisted: boolean) {
      if (persisted) closed = false;
    },
    /** Gắn vào sự kiện vòng đời thật của trang. */
    attach(win: Window = window, doc: Document = document) {
      const onVis = () => doc.visibilityState === 'hidden' && this.onHidden();
      const onHide = () => this.onPageHide();
      const onShow = (e: PageTransitionEvent) => this.onPageShow(e.persisted);
      doc.addEventListener('visibilitychange', onVis);
      win.addEventListener('pagehide', onHide);
      win.addEventListener('pageshow', onShow);
      return () => {
        doc.removeEventListener('visibilitychange', onVis);
        win.removeEventListener('pagehide', onHide);
        win.removeEventListener('pageshow', onShow);
      };
    },
    get queueSize() {
      return queue.length;
    },
    get inFlightSize() {
      return inFlight.length;
    },
    get isFlushing() {
      return flushing !== null;
    },
    destroy() {
      clearInterval(timer);
      clearTimeout(firstTimer);
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;

/** Transport thật cho trình duyệt: text/plain để không cần preflight CORS, keepalive cho lô nhỏ. */
export const browserTransport: Transport = {
  async post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'text/plain' },
      keepalive: body.length < 60_000,
    });
    const json = res.status === 207 ? await res.json().catch(() => null) : undefined;
    return { status: res.status, body: json };
  },
  beacon(url, body) {
    return navigator.sendBeacon?.(url, new Blob([body], { type: 'text/plain' })) ?? false;
  },
};

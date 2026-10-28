/**
 * Upload tiếp tục được (kiểu rupload của Facebook): hỏi server đã nhận tới byte nào, gửi phần còn lại
 * với header Offset; băm file để server bỏ qua file đã có; phát hiện upload "treo" khi không có
 * tiến độ trong vài giây; thử lại có backoff. Viết lại từ đầu.
 */

export interface UploadTransport {
  /** Bắt đầu phiên: server có thể trả skipUpload nếu đã có file cùng hash. */
  start(info: { size: number; name: string; type: string; hash: string | null }): Promise<{ sessionKey: string; skipUpload?: boolean; handle?: string }>;
  /** GET: server đã nhận bao nhiêu byte của phiên này. */
  getOffset(sessionKey: string): Promise<number>;
  /** POST phần [offset, size) với header Offset; báo tiến độ theo byte đã gửi trong request này. */
  send(sessionKey: string, body: Blob, offset: number, total: number, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<{ handle: string }>;
}

export class TransientError extends Error {}

export function backoffDelay(attempt: number, { base = 2, capMs = 30_000, jitter = 0.3, random = Math.random } = {}): number {
  const raw = Math.min(capMs, Math.pow(base, attempt) * 1000); // gốc: Math.pow(base, n) * 1e3, có/không có trần
  return Math.round(raw * (1 - jitter + random() * jitter * 2)); // jitter để hàng nghìn client không thử lại cùng lúc
}

/** SHA-256 của file nhỏ, dạng hex. File lớn thì bỏ qua (WebCrypto không băm theo luồng). */
export async function hashSmallFile(file: Blob, maxBytes: number): Promise<string | null> {
  if (file.size > maxBytes || typeof crypto === 'undefined' || !crypto.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

type MonitorEvent = 'stalled' | 'online';

/**
 * Coi upload là "treo" khi không có sự kiện tiến độ trong stallMs. Sự kiện `offline` của trình duyệt
 * chỉ là gợi ý (nó báo sai cả hai chiều), nên khi nhận được thì vẫn chờ thêm xem tiến độ có dừng thật không.
 */
export class StallMonitor {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<(e: MonitorEvent) => void>();
  private active = false;
  private readonly onOnline = () => this.emit('online');
  private readonly onOffline = () => this.active && this.arm();

  constructor(
    private readonly stallMs = 2000,
    private readonly target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window,
  ) {}

  on(fn: (e: MonitorEvent) => void): () => void {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  }

  private emit(e: MonitorEvent) {
    this.listeners.forEach((fn) => fn(e));
  }

  private arm() {
    this.clear();
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.active) this.emit('stalled');
    }, this.stallMs);
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  start() {
    if (!this.active) {
      this.target?.addEventListener('online', this.onOnline);
      this.target?.addEventListener('offline', this.onOffline);
    }
    this.active = true;
    this.arm();
  }

  /** Gửi xong byte cuối thì chờ server trả lời, không có tiến độ nữa là bình thường. */
  progress(loaded: number, total: number) {
    if (!this.active) return;
    if (loaded >= total) this.clear();
    else this.arm();
  }

  /** Dừng đếm treo nhưng vẫn nghe `online` để biết lúc nên thử lại. */
  pause() {
    this.active = false;
    this.clear();
  }

  dispose() {
    this.pause();
    this.target?.removeEventListener('online', this.onOnline);
    this.target?.removeEventListener('offline', this.onOffline);
    this.listeners.clear();
  }
}

export type UploadEvent =
  | { type: 'hashed'; hash: string | null; ms: number }
  | { type: 'session'; sessionKey: string }
  | { type: 'resume'; offset: number; attempt: number }
  | { type: 'progress'; sent: number; total: number }
  | { type: 'retry'; reason: string; delayMs: number; attempt: number }
  | { type: 'skipped' }
  | { type: 'done'; handle: string; bytesSent: number }
  | { type: 'failed'; error: string };

export interface UploadOptions {
  maxRetries?: number;
  hashMaxBytes?: number;
  stallMs?: number;
  backoff?: Parameters<typeof backoffDelay>[1];
  /** false: mỗi lần lỗi gửi lại từ byte 0 (cách ngây thơ, để demo so sánh). */
  resume?: boolean;
  monitor?: StallMonitor;
  onEvent?: (e: UploadEvent) => void;
}

/** Một lần upload: trả promise kết thúc đúng một lần (thành công, thất bại hoặc bị huỷ) và hàm cancel. */
export function resumableUpload(file: File | Blob, transport: UploadTransport, o: UploadOptions = {}) {
  const { maxRetries = 6, hashMaxBytes = 50 * 1024 * 1024, stallMs = 2000, resume = true, onEvent = () => {} } = o;
  const monitor = o.monitor ?? new StallMonitor(stallMs);
  const outer = new AbortController();
  let bytesSent = 0;

  const waitBeforeRetry = (ms: number) =>
    new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      const off = monitor.on((e) => e === 'online' && done()); // có mạng lại thì thử ngay
      outer.signal.addEventListener('abort', done);
      function done() {
        clearTimeout(t);
        off();
        outer.signal.removeEventListener('abort', done);
        resolve();
      }
    });

  const promise = (async (): Promise<UploadEvent> => {
    const name = 'name' in file ? file.name : 'blob';
    const t0 = performance.now();
    const hash = await hashSmallFile(file, hashMaxBytes);
    onEvent({ type: 'hashed', hash, ms: performance.now() - t0 });
    const session = await transport.start({ size: file.size, name, type: file.type, hash });
    if (session.skipUpload && session.handle) {
      onEvent({ type: 'skipped' });
      return { type: 'done', handle: session.handle, bytesSent: 0 };
    }
    onEvent({ type: 'session', sessionKey: session.sessionKey });

    let failures = 0; // lỗi LIÊN TIẾP không có tiến độ; có tiến độ thì đếm lại từ 0
    for (let attempt = 0; ; attempt++) {
      if (outer.signal.aborted) throw new DOMException('Đã huỷ', 'AbortError');
      const request = new AbortController();
      let lastLoaded = 0;
      const abortRequest = () => request.abort();
      outer.signal.addEventListener('abort', abortRequest);
      const stopWatching = monitor.on((e) => e === 'stalled' && request.abort(new TransientError('Không có tiến độ, coi như treo')));
      try {
        const offset = resume && attempt > 0 ? await transport.getOffset(session.sessionKey) : 0;
        onEvent({ type: 'resume', offset, attempt });
        monitor.start();
        const { handle } = await transport.send(
          session.sessionKey,
          file.slice(offset),
          offset,
          file.size,
          (loaded) => {
            bytesSent += loaded - lastLoaded; // tổng byte thật sự đi qua mạng, kể cả phần bị gửi lại
            lastLoaded = loaded;
            monitor.progress(offset + loaded, file.size);
            onEvent({ type: 'progress', sent: offset + loaded, total: file.size });
          },
          request.signal,
        );
        return { type: 'done', handle, bytesSent };
      } catch (err) {
        if (outer.signal.aborted) throw new DOMException('Đã huỷ', 'AbortError');
        const reason = request.signal.reason instanceof TransientError ? request.signal.reason : err;
        failures = lastLoaded > 0 ? 0 : failures + 1;
        if (!(reason instanceof TransientError) || failures > maxRetries) throw reason;
        const delayMs = backoffDelay(failures, o.backoff);
        onEvent({ type: 'retry', reason: reason.message, delayMs, attempt: attempt + 1 });
        monitor.pause();
        await waitBeforeRetry(delayMs);
      } finally {
        stopWatching();
        outer.signal.removeEventListener('abort', abortRequest);
      }
    }
  })()
    .catch((err: unknown): UploadEvent => ({ type: 'failed', error: err instanceof Error ? err.message : String(err) }))
    .then((final) => {
      if (!o.monitor) monitor.dispose();
      else monitor.pause();
      onEvent(final); // kết thúc đúng MỘT lần (bản gốc có thể phát FAIL hai lần)
      return final;
    });

  return { promise, cancel: () => outer.abort() };
}

/** Transport thật trên XMLHttpRequest (fetch chưa có tiến độ upload ổn định), theo giao thức kiểu rupload. */
export function xhrTransport(baseUrl: string, startUrl: string): UploadTransport {
  const xhr = <T>(method: string, url: string, body: Blob | string | null, headers: Record<string, string>, signal?: AbortSignal, onProgress?: (n: number) => void) =>
    new Promise<T>((resolve, reject) => {
      const req = new XMLHttpRequest();
      req.open(method, url);
      req.withCredentials = true;
      Object.entries(headers).forEach(([k, v]) => req.setRequestHeader(k, v));
      if (onProgress) req.upload.onprogress = (e) => onProgress(e.loaded);
      req.onload = () =>
        req.status >= 200 && req.status < 300
          ? resolve(JSON.parse(req.responseText) as T)
          : reject(req.status >= 500 || req.status === 429 ? new TransientError(`HTTP ${req.status}`) : new Error(`HTTP ${req.status}`));
      req.onerror = () => reject(new TransientError('Lỗi mạng'));
      signal?.addEventListener('abort', () => req.abort());
      req.onabort = () => reject(signal?.reason ?? new DOMException('Đã huỷ', 'AbortError'));
      req.send(body);
    });
  return {
    start: (info) => xhr('POST', startUrl, JSON.stringify(info), { 'Content-Type': 'application/json' }),
    getOffset: async (key) => (await xhr<{ offset: number }>('GET', `${baseUrl}/${key}`, null, {})).offset,
    send: (key, body, offset, total, onProgress, signal) =>
      xhr('POST', `${baseUrl}/${key}`, body, { Offset: String(offset), 'X-Entity-Length': String(total) }, signal, onProgress),
  };
}

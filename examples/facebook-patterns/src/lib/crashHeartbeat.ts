/**
 * Phát hiện tab bị crash bằng heartbeat trong localStorage (ý tưởng từ Bandicoot của Facebook):
 * - Mỗi tab ghi bản ghi của mình vào MỘT khoá chung (map sessionId → record) mỗi `heartbeatMs`.
 * - Bản ghi còn "active" mà lâu không được cập nhật nghĩa là tab đã chết mà không kịp đóng.
 * - Nhiều tab cùng thấy một crash: dùng "nhận việc hai pha" để chỉ một tab báo cáo.
 * Khác bản gốc: tự đóng phiên khi pagehide, lưu trữ và đồng hồ tiêm vào được,
 * ghi lỗi thì dừng thay vì xoá luôn dữ liệu của các tab khác.
 */

export type SessionStatus = 'active' | 'inactive' | 'closed';

export interface SessionRecord {
  status: SessionStatus;
  startedAt: number;
  lastUpdated: number;
  /** tab đang nhận việc báo cáo crash của bản ghi này, và lúc nhận */
  claimBy?: string;
  claimAt?: number;
  data?: Record<string, unknown>;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CrashMonitorOptions {
  storage: StorageLike;
  /** khoá chung cho mọi tab cùng loại, vd 'crash:video-upload' */
  key: string;
  sessionId?: string;
  now?: () => number;
  heartbeatMs?: number;
  /** active mà im lặng lâu hơn mức này thì coi là crash (bản gốc: 10 phút) */
  crashAfterMs?: number;
  /** bản ghi cũ hơn mức này bị dọn, kể cả chưa ai báo (bản gốc: 14 ngày) */
  forgetAfterMs?: number;
  /** dữ liệu gắn vào heartbeat để biết lúc crash trang đang thế nào */
  collect?: () => Record<string, unknown>;
  onCrash: (sessionId: string, record: SessionRecord) => void;
  onError?: (error: unknown) => void;
  /** true: không tự hẹn giờ, không nghe sự kiện trang; người gọi tự gọi beat() (test, mô phỏng) */
  manual?: boolean;
}

export interface CrashMonitor {
  readonly sessionId: string;
  start(): void;
  /** một nhịp: ghi bản ghi của mình, rồi xét các bản ghi khác */
  beat(): void;
  setVisible(visible: boolean): void;
  stop(): void;
}

export function isCrashed(record: SessionRecord, now: number, crashAfterMs: number) {
  return record.status === 'active' && now - record.lastUpdated > crashAfterMs;
}

export function createCrashMonitor(options: CrashMonitorOptions): CrashMonitor {
  const {
    storage,
    key,
    now = Date.now,
    heartbeatMs = 5_000,
    crashAfterMs = 10 * 60_000,
    forgetAfterMs = 14 * 24 * 3_600_000,
  } = options;
  // Cửa sổ nhận việc phải dài hơn một nhịp: tab khác có ít nhất một nhịp để "giành" lại.
  const claimMs = heartbeatMs * 2;
  const sessionId = options.sessionId ?? Math.random().toString(36).slice(2, 9);
  let status: SessionStatus = 'active';
  let startedAt = 0;
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let broken = false;

  const read = (): Record<string, SessionRecord> => {
    try {
      const parsed = JSON.parse(storage.getItem(key) ?? '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {}; // JSON hỏng: coi như rỗng, lần ghi sau sẽ thay
    }
  };

  const write = (sessions: Record<string, SessionRecord>) => {
    try {
      storage.setItem(key, JSON.stringify(sessions));
    } catch (error) {
      // Đầy bộ nhớ: dừng theo dõi, KHÔNG xoá khoá chung (còn bằng chứng crash của tab khác).
      broken = true;
      stop();
      options.onError?.(error);
    }
  };

  function beat() {
    if (broken || !running) return;
    const t = now();
    const sessions = read();
    sessions[sessionId] = {
      ...sessions[sessionId],
      status,
      startedAt,
      lastUpdated: t,
      data: options.collect?.(),
    };
    for (const [id, record] of Object.entries(sessions)) {
      if (id === sessionId) continue;
      const silent = t - record?.lastUpdated;
      // đóng đàng hoàng, tab ẩn rồi im lặng (không biết có crash không), hoặc quá cũ: bỏ
      const forget =
        !record?.status ||
        record.status === 'closed' ||
        (record.status === 'inactive' && silent > crashAfterMs) ||
        silent > forgetAfterMs;
      if (forget) {
        delete sessions[id];
      } else if (isCrashed(record, t, crashAfterMs)) {
        if (record.claimBy === sessionId) {
          // Pha 2: nhận việc từ nhịp trước và không ai giành lại → mình báo.
          delete sessions[id];
          options.onCrash(id, record);
        } else if (!record.claimAt || t - record.claimAt > claimMs) {
          // Pha 1: chưa ai nhận (hoặc người nhận cũng đã chết) → ghi tên mình vào.
          record.claimBy = sessionId;
          record.claimAt = t;
        }
      }
    }
    write(sessions);
  }

  function update(next: SessionStatus) {
    status = next;
    beat();
  }

  const onVisibility = () => update(document.visibilityState === 'hidden' ? 'inactive' : 'active');
  const onPageHide = () => stop();

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (!running) return;
    if (!broken) update('closed');
    running = false;
    if (!options.manual) {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    }
  }

  return {
    sessionId,
    beat,
    stop,
    setVisible: (visible) => update(visible ? 'active' : 'inactive'),
    start() {
      if (running || broken) return;
      running = true;
      startedAt = now();
      status = 'active';
      beat();
      if (!options.manual) {
        timer = setInterval(beat, heartbeatMs);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
      }
    },
  };
}

/**
 * Dò proxy/CDN cache nhầm trang cá nhân hoá (ý tưởng từ DetectBrokenProxyCache):
 * server nhúng user id vào HTML; cookie đăng nhập là của người đang dùng trình duyệt.
 * Hai giá trị khác nhau nghĩa là HTML này được render cho NGƯỜI KHÁC rồi bị cache lại.
 */
export function checkProxyCache(renderedUserId: string, cookieUserId: string | null) {
  const broken = renderedUserId !== '0' && cookieUserId != null && cookieUserId !== renderedUserId;
  return { broken, renderedUserId, cookieUserId };
}

export function readCookie(
  name: string,
  cookie = typeof document === 'undefined' ? '' : document.cookie,
) {
  for (const part of cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

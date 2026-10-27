/**
 * Gợi ý tính năng mới theo nhiều phiên (feature discoverability), ý tưởng từ
 * browse/components/feature-discovery của Udemy: một máy trạng thái nhỏ quyết định lúc nào
 * hiện banner nhẹ (PASSIVE), lúc nào hiện modal (ACTIVE), lúc nào im lặng (PAUSED/DORMANT),
 * lúc nào thôi hẳn (END). Trạng thái lưu theo từng user + tính năng.
 *
 * Khác bản gốc: đếm phiên theo mốc lần ĐẾM gần nhất (bản gốc dùng lần XEM gần nhất nên người
 * vào hằng ngày không bao giờ được đếm thêm phiên), sự kiện gửi đúng tính năng thay vì phát
 * tên chung chung lên `document`, có `dispose()`.
 */

export type FeatureState = 'PASSIVE' | 'ACTIVE' | 'PAUSED' | 'DORMANT' | 'END';
export type FeatureEvent =
  | 'ESCALATE'
  | 'DE_ESCALATE'
  | 'DESIRED_ACTION'
  | 'DISMISS_FOREVER'
  | 'GO_DORMANT'
  | 'DELAY_TO_DORMANT'
  | 'DELAY_TO_PAUSED'
  | 'RESUME'
  | 'RESURRECT';

export interface FeatureConfig {
  id: string;
  /** số phiên ở PASSIVE trước khi được nâng lên ACTIVE */
  escalateAfterSessions: number;
  /** quá số phiên này mà vẫn lờ đi thì cho "ngủ" */
  dormantAfterSessions: number;
  /** PAUSED ("để sau") bao nhiêu phiên thì hiện lại */
  resumeAfterSessions: number;
  /** DORMANT bao nhiêu ngày thì quay lại PASSIVE */
  daysToResurrect: number;
}

export interface FeatureData {
  state: FeatureState;
  sessionCount: number;
  sessionId: string;
  /** lần cuối tính thêm 1 phiên */
  lastCountedAt: number;
  /** lần cuối tính năng được nhìn thấy */
  lastSeenAt: number;
  dormantSince: number | null;
}

export interface FeatureStorage {
  get(key: string): FeatureData | undefined;
  set(key: string, data: FeatureData): void;
}

export const DAY = 24 * 3600 * 1000;

type Guard = (d: FeatureData, c: FeatureConfig, now: number) => boolean;
type Effect = (d: FeatureData, now: number) => void;
interface Transition {
  target: FeatureState;
  guard?: Guard;
  effect?: Effect;
}

const resetCount: Effect = (d) => {
  d.sessionCount = 1;
};
const markDormant: Effect = (d, now) => {
  d.dormantSince = now;
};
const shouldGoDormant: Guard = (d, c) => d.sessionCount > c.dormantAfterSessions;

/** Bảng chuyển trạng thái: sự kiện không có trong bảng của trạng thái hiện tại thì bị bỏ qua. */
export const MACHINE: Record<FeatureState, Partial<Record<FeatureEvent, Transition>>> = {
  PASSIVE: {
    ESCALATE: { target: 'ACTIVE', guard: (d, c) => d.sessionCount > c.escalateAfterSessions },
    DESIRED_ACTION: { target: 'END' },
    DISMISS_FOREVER: { target: 'END' },
    GO_DORMANT: { target: 'DORMANT', guard: shouldGoDormant, effect: markDormant },
    DELAY_TO_DORMANT: { target: 'DORMANT', effect: markDormant },
    DELAY_TO_PAUSED: { target: 'PAUSED', effect: resetCount },
  },
  ACTIVE: {
    DE_ESCALATE: { target: 'PASSIVE' },
    DESIRED_ACTION: { target: 'END' },
    DISMISS_FOREVER: { target: 'END' },
    DELAY_TO_PAUSED: { target: 'PAUSED', effect: resetCount },
  },
  PAUSED: {
    RESUME: { target: 'ACTIVE', guard: (d, c) => d.sessionCount > c.resumeAfterSessions, effect: resetCount },
  },
  DORMANT: {
    RESURRECT: {
      target: 'PASSIVE',
      guard: (d, c, now) => d.dormantSince !== null && now > d.dormantSince + c.daysToResurrect * DAY,
      effect: (d) => {
        d.sessionCount = 1;
        d.dormantSince = null;
      },
    },
  },
  END: {},
};

export interface DiscoveryOptions {
  userId: string;
  storage: FeatureStorage;
  /** id phiên hiện tại (VD từ session tracking); đổi id + đủ khoảng cách thì tính phiên mới */
  sessionId: string;
  now?: () => number;
  /** khoảng tối thiểu giữa hai lần đếm phiên */
  sessionGap?: number;
  /**
   * 'since-last-count' (mặc định): mốc là lần đếm gần nhất.
   * 'since-last-seen': mốc là lần nhìn thấy gần nhất (cách của bản gốc, để so sánh).
   */
  boundary?: 'since-last-count' | 'since-last-seen';
  onTransition?: (from: FeatureState, to: FeatureState, event: FeatureEvent) => void;
}

export function createFeatureDiscovery(config: FeatureConfig, options: DiscoveryOptions) {
  const { storage, userId, now = Date.now, sessionGap = DAY, boundary = 'since-last-count' } = options;
  // dùng ký tự phân cách để "1"+"2abc" không trùng với "12"+"abc"
  const key = `${userId}::${config.id}`;
  const t0 = now();
  const data: FeatureData = storage.get(key) ?? {
    state: 'PASSIVE',
    sessionCount: 1,
    sessionId: options.sessionId,
    lastCountedAt: t0,
    lastSeenAt: t0,
    dormantSince: null,
  };
  let disposed = false;

  const save = () => !disposed && storage.set(key, { ...data });

  function dispatch(event: FeatureEvent) {
    if (disposed) return false;
    const tr = MACHINE[data.state][event];
    const t = now();
    if (!tr || (tr.guard && !tr.guard(data, config, t))) return false;
    const from = data.state;
    tr.effect?.(data, t);
    data.state = tr.target;
    save();
    if (from !== tr.target) options.onTransition?.(from, tr.target, event);
    return true;
  }

  function isNewSession(sessionId: string) {
    const t = now();
    const anchor = boundary === 'since-last-count' ? data.lastCountedAt : data.lastSeenAt;
    return sessionId !== data.sessionId && t - anchor >= sessionGap;
  }

  /** Gọi mỗi lần người dùng mở trang có tính năng này. */
  function visit(sessionId: string) {
    const t = now();
    if (isNewSession(sessionId)) {
      data.sessionCount += 1;
      data.lastCountedAt = t;
      dispatch('RESUME');
      dispatch('GO_DORMANT');
      dispatch('ESCALATE');
    }
    data.sessionId = sessionId;
    data.lastSeenAt = t;
    dispatch('RESURRECT');
    save();
  }

  visit(options.sessionId);

  return {
    dispatch,
    visit,
    get state() {
      return data.state;
    },
    get sessionCount() {
      return data.sessionCount;
    },
    /** trạng thái có hiện gì không */
    get visible() {
      return data.state === 'PASSIVE' || data.state === 'ACTIVE';
    },
    dispose() {
      disposed = true;
    },
  };
}

export type FeatureDiscovery = ReturnType<typeof createFeatureDiscovery>;

/** Lưu vào localStorage, lỗi (private mode, đầy quota) thì bỏ qua. */
export function localStorageAdapter(prefix = 'feature-discovery:'): FeatureStorage {
  return {
    get(k) {
      try {
        const raw = localStorage.getItem(prefix + k);
        return raw ? (JSON.parse(raw) as FeatureData) : undefined;
      } catch {
        return undefined;
      }
    },
    set(k, d) {
      try {
        localStorage.setItem(prefix + k, JSON.stringify(d));
      } catch {
        /* bỏ qua */
      }
    },
  };
}

export function memoryStorage(): FeatureStorage & { dump(): Record<string, FeatureData> } {
  const m = new Map<string, FeatureData>();
  return {
    get: (k) => (m.has(k) ? { ...m.get(k)! } : undefined),
    set: (k, d) => void m.set(k, { ...d }),
    dump: () => Object.fromEntries(m),
  };
}

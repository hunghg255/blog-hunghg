/**
 * Hai mẹo của kênh long-poll cũ trên Facebook (ChannelSubdomain + ChannelManager):
 * 1. Chia subdomain giữa các tab bằng "lease" trong localStorage, để các tab không
 *    dồn long-poll vào cùng một host (trình duyệt chỉ cho khoảng 6 kết nối mỗi host).
 * 2. Máy trạng thái long-poll điều khiển bằng bảng chuyển: hậu tố `!` = đi ngay (có chặn tần suất),
 *    không hậu tố = chờ backoff có jitter; stateId tăng mỗi lần vào state để bỏ phản hồi muộn.
 * Khác bản gốc: lease ghi kèm chủ sở hữu nên phát hiện được hai tab giành cùng slot,
 * xin lại slot khi trang quay về từ bfcache, đồng hồ/storage/timer tiêm vào được.
 */

// ───────────────────────── 1. Lease subdomain ─────────────────────────

export interface LeaseStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SubdomainLeaseOptions {
  storage: LeaseStorage | null;
  /** số kết nối mỗi host dành cho kênh; giữ lại 1 cho request thường (bản gốc: max_conn = 2) */
  maxConn: number;
  /** số subdomain có thật, vd 0-edge-chat … 6-edge-chat (bản gốc: 7) */
  hosts?: number;
  /** lease không được gia hạn quá lâu thì coi là trống (bản gốc: 100 giây) */
  ttlMs?: number;
  prefix?: string;
  owner?: string;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** true: không tự hẹn giờ gia hạn, không nghe pagehide/pageshow (test, mô phỏng) */
  manual?: boolean;
}

export interface SlotRecord {
  slot: number;
  owner: string;
  at: number;
}

export interface SubdomainLease {
  readonly owner: string;
  /** slot đang giữ, null nếu không xin được (dùng host chung) */
  readonly slot: number | null;
  /** số subdomain tương ứng (slot % hosts), null = host chung */
  readonly host: number | null;
  acquire(): number | null;
  /** ghi lại thời điểm; nếu slot đã bị tab khác ghi đè thì xin slot khác. Trả false nếu mất slot */
  renew(): boolean;
  release(): void;
}

const enc = (owner: string, at: number) => `${owner}|${at}`;
function dec(raw: string | null): { owner: string; at: number } | null {
  if (!raw) return null;
  const bar = raw.lastIndexOf('|');
  // bản gốc chỉ lưu timestamp: vẫn đọc được, chủ là ''
  if (bar < 0) return { owner: '', at: parseInt(raw, 10) || 0 };
  return { owner: raw.slice(0, bar), at: parseInt(raw.slice(bar + 1), 10) || 0 };
}

/** Đọc mọi lease đang có trong storage (để debug, demo). */
export function readSlots(storage: LeaseStorage, prefix = 'channel_sub:'): SlotRecord[] {
  const out: SlotRecord[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key || !key.startsWith(prefix)) continue;
    const rec = dec(storage.getItem(key));
    const slot = parseInt(key.slice(prefix.length), 10);
    if (rec && Number.isInteger(slot)) out.push({ slot, ...rec });
  }
  return out.sort((a, b) => a.slot - b.slot);
}

export function createSubdomainLease(options: SubdomainLeaseOptions): SubdomainLease {
  const {
    storage,
    hosts = 7,
    ttlMs = 100_000,
    prefix = 'channel_sub:',
    now = Date.now,
    random = Math.random,
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    manual = false,
  } = options;
  const owner = options.owner ?? random().toString(36).slice(2, 10);
  const total = Math.max(0, options.maxConn - 1) * hosts;
  let slot: number | null = null;
  let timer: unknown = null;

  const isFree = (s: number, t: number) => {
    const rec = dec(storage!.getItem(prefix + s));
    return !rec || rec.owner === owner || rec.at < t - ttlMs;
  };

  const write = () => {
    try {
      storage!.setItem(prefix + slot, enc(owner, now()));
    } catch {
      /* đầy bộ nhớ: vẫn giữ slot trong bộ nhớ, lần gia hạn sau thử lại */
    }
  };

  const schedule = () => {
    if (manual) return;
    if (timer != null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      lease.renew();
      if (slot != null) schedule();
    }, ttlMs / 2);
  };

  const lease: SubdomainLease = {
    owner,
    get slot() {
      return slot;
    },
    get host() {
      return slot == null ? null : slot % hosts;
    },
    acquire() {
      if (slot != null) return slot;
      if (!storage || total === 0) return null;
      // bắt đầu từ vị trí ngẫu nhiên để các tab mở cùng lúc ít va nhau
      const start = Math.floor(random() * total);
      const t = now();
      for (let i = 0; i < total; i++) {
        const s = (start + i) % total;
        if (isFree(s, t)) {
          slot = s;
          write();
          schedule();
          return slot;
        }
      }
      return null;
    },
    renew() {
      if (slot == null || !storage) return false;
      const rec = dec(storage.getItem(prefix + slot));
      if (rec && rec.owner !== owner && rec.at >= now() - ttlMs) {
        // tab khác đã giành slot này (hai tab đọc cùng lúc, hoặc mình ngủ quá ttl)
        slot = null;
        lease.acquire();
        return false;
      }
      write();
      return true;
    },
    release() {
      if (timer != null) clearTimer(timer);
      timer = null;
      if (slot != null && storage) {
        const rec = dec(storage.getItem(prefix + slot));
        // chỉ xoá lease của chính mình
        if (!rec || rec.owner === owner) storage.removeItem(prefix + slot);
      }
      slot = null;
    },
  };

  if (!manual && typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => lease.release());
    // bản gốc không xin lại khi trang quay về từ back/forward cache
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) lease.acquire();
    });
  }
  return lease;
}

// ───────────────────────── 2. Máy trạng thái long-poll ─────────────────────────

/** state → (status → state kế tiếp). `!` = đi ngay, không hậu tố = chờ backoff. */
export type TransitionTable = Record<string, Record<string, string>>;

/** Bảng của ChannelManager, giữ nguyên tên status. */
export const CHANNEL_TABLE: TransitionTable = {
  idle: { ok: 'init!' },
  init: { ok: 'pull!', error: 'reconnect', sys_online: 'init', sys_timetravel: 'init' },
  pull: {
    ok: 'pull!',
    error: 'ping',
    error_missing: 'pull',
    error_msg_type: 'pull',
    refresh_0: 'reconnect',
    refresh_110: 'reconnect',
    refresh_111: 'reconnect',
    refresh_112: 'pull',
    refresh_113: 'pull',
    refresh_117: 'reconnect',
  },
  ping: { ok: 'pull!', error: 'ping', error_stale: 'reconnect!' },
  reconnect: { ok: 'init!', error: 'reconnect', sys_online: 'reconnect', sys_timetravel: 'reconnect' },
  shutdown: {},
  _all: {
    error_max: 'shutdown!',
    error_shutdown: 'shutdown!',
    sys_owner: 'reconnect',
    sys_nonowner: 'idle!',
    sys_online: 'ping',
    sys_offline: 'idle!',
    sys_timetravel: 'ping',
  },
};

export type FsmEvent =
  | { type: 'enter'; state: string; stateId: number }
  | { type: 'defer'; state: string; delayMs: number; reason: 'backoff' | 'throttle' }
  | { type: 'stale'; stateId: number; current: number; status: string }
  | { type: 'exit'; from: string; status: string; to: string };

export interface ChannelFsmOptions {
  table?: TransitionTable;
  now?: () => number;
  random?: () => number;
  /** hẹn chạy fn sau ms, trả hàm huỷ */
  schedule?: (fn: () => void, ms: number) => () => void;
  minRetryMs?: number;
  maxRetryMs?: number;
  /** quá tần suất này (trung bình trên rateWindowMs) thì `!` cũng phải chờ */
  maxStatesPerSec?: number;
  rateWindowMs?: number;
  /** vào state thật (gửi request…); gọi exit(stateId, status) khi xong */
  onEnter?: (state: string, stateId: number) => void;
  onEvent?: (event: FsmEvent) => void;
}

export interface ChannelFsm {
  readonly state: string;
  readonly stateId: number;
  readonly retries: number;
  /** state đang chờ hẹn giờ (đang ở idle), nếu có */
  readonly pending: { state: string; at: number } | null;
  enter(target: string): void;
  /** kết quả của request thuộc stateId; trả false nếu là phản hồi muộn bị bỏ */
  exit(stateId: number, status: string): boolean;
  /** sự kiện hệ thống (sys_online, sys_offline…) áp cho state hiện tại */
  signal(status: string): void;
  /** chờ backoff tiếp theo sẽ là bao lâu (chưa jitter) */
  nextBackoffMs(): number;
  dispose(): void;
}

export function backoffDelay(retries: number, minMs: number, maxMs: number, rand: number) {
  const base = Math.min(minMs * 2 ** Math.max(0, retries - 1), maxMs);
  return Math.floor(base * (1 + rand * 0.5));
}

export function createChannelFsm(options: ChannelFsmOptions = {}): ChannelFsm {
  const {
    table = CHANNEL_TABLE,
    now = Date.now,
    random = Math.random,
    schedule = (fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    },
    minRetryMs = 5_000,
    maxRetryMs = 320_000,
    maxStatesPerSec = 1,
    rateWindowMs = 30_000,
    onEnter,
    onEvent,
  } = options;

  let state = 'idle';
  let stateId = 0;
  let retries = 0;
  let pending: { state: string; at: number } | null = null;
  let cancelPending: (() => void) | null = null;
  const entries: number[] = []; // thời điểm vào state, để đo tần suất

  const rate = () => {
    const t = now();
    while (entries.length && entries[0] < t - rateWindowMs) entries.shift();
    return entries.length / (rateWindowMs / 1000);
  };

  const fsm: ChannelFsm = {
    get state() {
      return state;
    },
    get stateId() {
      return stateId;
    },
    get retries() {
      return retries;
    },
    get pending() {
      return pending;
    },
    enter(target) {
      const name = target.replace(/\W*$/, '');
      if (!table[name]) throw new Error('invalid state: ' + name);
      // mỗi lần vào state (kể cả chỉ để chờ) đều làm mọi callback cũ hết hiệu lực
      stateId++;
      cancelPending?.();
      cancelPending = null;
      pending = null;

      let delay = 0;
      let reason: 'backoff' | 'throttle' = 'backoff';
      if (target.endsWith('!')) {
        const r = rate();
        if (r >= maxStatesPerSec) {
          delay = Math.round(1000 / maxStatesPerSec);
          reason = 'throttle';
        }
      } else if (!target.endsWith('#')) {
        delay = backoffDelay(retries, minRetryMs, maxRetryMs, random());
      }

      if (delay > 0) {
        state = 'idle';
        pending = { state: name, at: now() + delay };
        onEvent?.({ type: 'defer', state: name, delayMs: delay, reason });
        // `#` = đã chờ rồi, lần sau vào thẳng
        cancelPending = schedule(() => {
          cancelPending = null;
          fsm.enter(name + '#');
        }, delay);
        return;
      }
      state = name;
      entries.push(now());
      onEvent?.({ type: 'enter', state, stateId });
      onEnter?.(state, stateId);
    },
    exit(id, status) {
      if (state === 'shutdown') return false;
      if (id < stateId) {
        onEvent?.({ type: 'stale', stateId: id, current: stateId, status });
        return false;
      }
      retries = status === 'ok' ? 0 : retries + 1;
      // đang chờ vào state X thì tra bảng theo X (giống `nextState || state` của bản gốc)
      const from = pending?.state ?? state;
      const next = table[from]?.[status] ?? table._all?.[status] ?? 'shutdown!';
      onEvent?.({ type: 'exit', from, status, to: next });
      fsm.enter(next);
      return true;
    },
    signal(status) {
      fsm.exit(stateId, status);
    },
    nextBackoffMs() {
      return Math.min(minRetryMs * 2 ** Math.max(0, retries - 1), maxRetryMs);
    },
    dispose() {
      cancelPending?.();
      cancelPending = null;
      pending = null;
      state = 'shutdown';
    },
  };
  return fsm;
}

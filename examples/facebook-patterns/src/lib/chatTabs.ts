/**
 * Dock chat kiểu Messenger web: bao nhiêu tab vừa màn hình, tin đến thì mở/thay tab nào,
 * chuỗi luật "có nên bật tab", hẹn giờ thông báo và hẹn giờ bỏ mute dài ngày.
 * Ý tưởng học từ MWChatMultitabCalc / MWChatMultitabReducer / MWChatVisibleChatHeads /
 * MWChatTabPolicy / MWChatCalculateIsMutedFromExpireTime, viết lại từ đầu.
 */

// ---------- 1. Bao nhiêu tab ----------

export interface TabLayout {
  /** độ rộng một tab, Messenger: 338 (306 khi bật bản thanh mảnh) */
  tabWidth?: number;
  /** dưới độ rộng này chỉ cho 1 tab */
  minViewport?: number;
  /** phần dành cho cột chat head */
  reserved?: number;
  /** bản gốc làm tròn lên; mặc định ở đây làm tròn xuống để không lấn quá nửa màn hình */
  round?: 'ceil' | 'floor';
}

export function maxOpenTabs(viewport: number, o: TabLayout = {}): number {
  const { tabWidth = 338, minViewport = 1100, reserved = 90, round = 'floor' } = o;
  if (viewport < minViewport) return 1;
  const n = (Math.floor(viewport / 2) - reserved) / tabWidth;
  return Math.max(1, round === 'ceil' ? Math.ceil(n) : Math.floor(n));
}

// ---------- 2. Tin đến thì làm gì với tab ----------

export interface ChatTab {
  threadId: string;
  focused: boolean;
  /** đang có chữ soạn dở */
  draft: boolean;
}

/** tabs[0] là tab mới nhất. heads: mọi thread đang có bong bóng, mới nhất trước. */
export interface Dock {
  tabs: ChatTab[];
  heads: string[];
}

export type Outcome = { kind: 'opened' } | { kind: 'replaced'; closed: string } | { kind: 'head-only' };

export interface IncomingOptions {
  /**
   * Mô phỏng bản gốc: không tìm được tab "không focus, không draft" thì lấy tab không focus
   * đầu tiên, kể cả tab đang có draft.
   */
  legacyFallback?: boolean;
}

export function onIncomingMessage(
  dock: Dock,
  threadId: string,
  max: number,
  o: IncomingOptions = {},
): { dock: Dock; outcome: Outcome } {
  const known = dock.heads.includes(threadId);
  const fresh: ChatTab = { threadId, focused: false, draft: false };

  if (!known && dock.tabs.length < max) {
    const tabs = [fresh, ...dock.tabs];
    return { dock: { tabs, heads: promoteHead(dock.heads, tabs, threadId) }, outcome: { kind: 'opened' } };
  }

  if (!known) {
    let victim = dock.tabs.findIndex((t) => !t.focused && !t.draft);
    if (victim === -1 && o.legacyFallback && dock.tabs.some((t) => !t.draft)) {
      victim = dock.tabs.findIndex((t) => !t.focused); // tab này có thể đang có draft
    }
    if (victim !== -1) {
      const closed = dock.tabs[victim].threadId;
      const tabs = [fresh, ...dock.tabs.filter((_, i) => i !== victim)];
      return {
        dock: { tabs, heads: promoteHead(dock.heads, tabs, threadId) },
        outcome: { kind: 'replaced', closed },
      };
    }
  }

  return { dock: { tabs: dock.tabs, heads: promoteHead(dock.heads, dock.tabs, threadId) }, outcome: { kind: 'head-only' } };
}

/** Thu nhỏ cửa sổ: giữ tab đang focus, bỏ tab cũ nhất trước. */
export function fitTabs(tabs: ChatTab[], max: number): ChatTab[] {
  if (tabs.length <= max) return tabs;
  const focused = tabs.find((t) => t.focused);
  const keep = new Set(tabs.filter((t) => t !== focused).slice(0, focused ? max - 1 : max));
  if (focused) keep.add(focused);
  return tabs.filter((t) => keep.has(t));
}

// ---------- 3. Chat head không nhảy ----------

export const MAX_BUBBLES = 6;

/** Bong bóng hiển thị: bỏ thread đang mở tab; quá 6 thì 5 bong bóng + một bong bóng "+N". */
export function visibleHeads(heads: string[], tabs: ChatTab[], maxBubbles = MAX_BUBBLES) {
  const free = heads.filter((h) => !tabs.some((t) => t.threadId === h));
  return free.length > maxBubbles
    ? { shown: free.slice(0, maxBubbles - 1), overflow: free.slice(maxBubbles - 1) }
    : { shown: free, overflow: [] as string[] };
}

/** Đưa thread lên đầu, trừ khi người dùng đang nhìn thấy nó (tab mở hoặc bong bóng đang hiện). */
export function promoteHead(heads: string[], tabs: ChatTab[], threadId: string, maxBubbles = MAX_BUBBLES) {
  if (!heads.includes(threadId)) return [threadId, ...heads];
  const onScreen =
    tabs.some((t) => t.threadId === threadId) || visibleHeads(heads, tabs, maxBubbles).shown.includes(threadId);
  return onScreen ? heads : [threadId, ...heads.filter((h) => h !== threadId)];
}

// ---------- 4. Chuỗi luật "có bật tab không" ----------

export interface PolicyRule<C> {
  name: string;
  /** true = chặn. Được phép bất đồng bộ (đọc setting, danh sách chặn...) */
  blocks: (ctx: C) => boolean | Promise<boolean>;
}

export type PolicyResult = { allowed: true } | { allowed: false; rule: string; error?: unknown };

/**
 * Chạy lần lượt, dừng ở luật đầu tiên chặn. Luôn trả kết quả (bản gốc im lặng khi bị chặn).
 * Luật ném lỗi thì coi như chặn: thà không bật tab còn hơn bật nhầm.
 */
export async function runPolicy<C>(rules: readonly PolicyRule<C>[], ctx: C): Promise<PolicyResult> {
  for (const rule of rules) {
    try {
      if (await rule.blocks(ctx)) return { allowed: false, rule: rule.name };
    } catch (error) {
      return { allowed: false, rule: rule.name, error };
    }
  }
  return { allowed: true };
}

// ---------- 5. Hẹn giờ ----------

/** Mỗi thread một timer thông báo; tin mới đến thì huỷ timer cũ rồi đặt lại. */
export class NotificationTimers {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(
    private onExpire: (threadId: string) => void,
    private ms = 3000,
  ) {}
  notify(threadId: string) {
    clearTimeout(this.timers.get(threadId)); // bản gốc thiếu dòng này
    this.timers.delete(threadId); // xoá rồi set lại để thread lên cuối thứ tự Map
    this.timers.set(
      threadId,
      setTimeout(() => {
        this.timers.delete(threadId);
        this.onExpire(threadId);
      }, this.ms),
    );
  }
  dismiss(threadId: string) {
    clearTimeout(this.timers.get(threadId));
    this.timers.delete(threadId);
  }
  active() {
    return [...this.timers.keys()];
  }
  dispose() {
    this.timers.forEach((id) => clearTimeout(id));
    this.timers.clear();
  }
}

/** setTimeout nhận delay kiểu int32: quá 2^31 - 1 ms (~24,8 ngày) là chạy ngay. */
export const MAX_TIMEOUT = 2 ** 31 - 1;

/** Hẹn giờ dài bao lâu cũng được: chia thành nhiều chặng không quá MAX_TIMEOUT. */
export function setLongTimeout(fn: () => void, delayMs: number, now: () => number = Date.now): () => void {
  const target = now() + delayMs;
  let id: ReturnType<typeof setTimeout>;
  const arm = () => {
    const left = Math.max(0, target - now());
    id = setTimeout(left > MAX_TIMEOUT ? arm : fn, Math.min(left, MAX_TIMEOUT));
  };
  arm();
  return () => clearTimeout(id);
}

/** muteUntil <= -1: mute vĩnh viễn. Ngược lại mute tới thời điểm đó (epoch ms). */
export function isMuted(muteUntil: number, now = Date.now()): boolean {
  return muteUntil <= -1 || muteUntil > now;
}

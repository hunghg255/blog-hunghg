/**
 * Trạng thái "đã thấy / đã đọc" của thông báo bằng 2 bit, và danh sách "thin client"
 * (ý tưởng từ NotificationSeenState và CometNotificationsThinClientConnectionHandler).
 *
 * SEEN = bit 1 (badge đỏ trên chuông), READ = bit 2 (chấm xanh trên từng thông báo).
 * Đọc kéo theo thấy, nên chỉ có 3 trạng thái hợp lệ: 0, 1, 3.
 * Khi cập nhật, `old ^ new` cho biết bit nào đổi, rồi phát hai sự kiện riêng:
 * badge chỉ nghe "seen", danh sách chỉ nghe "read".
 */

export const SEEN = 1;
export const READ = 2;
export const UNSEEN_AND_UNREAD = 0;
export const SEEN_BUT_UNREAD = SEEN;
export const SEEN_AND_READ = SEEN | READ;

export type SeenBits = 0 | 1 | 3;
export type PayloadSource = 'endpoint' | 'push' | 'sync';
type Listener = (ids: string[]) => void;

export function createSeenStore() {
  const states = new Map<string, SeenBits>();
  const listeners = { seen: new Set<Listener>(), read: new Set<Listener>() };

  /** Áp một loạt trạng thái mới, phát sự kiện theo bit thực sự đổi. */
  function apply(next: Record<string, SeenBits>) {
    const seenChanged: string[] = [];
    const readChanged: string[] = [];
    for (const [id, value] of Object.entries(next)) {
      const old = states.get(id);
      states.set(id, value);
      if (old === undefined) {
        // id mới: cả badge lẫn danh sách đều cần biết
        seenChanged.push(id);
        readChanged.push(id);
        continue;
      }
      const diff = old ^ value;
      if (diff & SEEN) seenChanged.push(id);
      if (diff & READ) readChanged.push(id);
    }
    if (seenChanged.length) listeners.seen.forEach((l) => l(seenChanged));
    if (readChanged.length) listeners.read.forEach((l) => l(readChanged));
  }

  return {
    /**
     * Payload tải trang ('endpoint') không được ghi đè id đã biết: dữ liệu đó có thể cũ hơn
     * trạng thái vừa nhận qua push/sync. Push và sync thì luôn ghi đè.
     */
    receive(items: Array<{ id: string; state: SeenBits }>, source: PayloadSource) {
      const next: Record<string, SeenBits> = {};
      items.forEach(({ id, state }) => {
        if (source === 'endpoint' && states.has(id)) return;
        next[id] = state;
      });
      apply(next);
    },
    /** Mở chuông: mọi id được đánh dấu đã thấy (giữ nguyên bit đọc). */
    markSeen(ids: string[]) {
      const next: Record<string, SeenBits> = {};
      ids.forEach((id) => {
        const old = states.get(id);
        if (old !== undefined) next[id] = (old | SEEN) as SeenBits;
      });
      apply(next);
    },
    /** Đọc thì kéo theo đã thấy; bỏ đọc chỉ xoá bit READ. */
    markRead(ids: string[], read = true) {
      const next: Record<string, SeenBits> = {};
      ids.forEach((id) => {
        const old = states.get(id);
        if (read) next[id] = SEEN_AND_READ as SeenBits;
        else if (old !== undefined) next[id] = (old & ~READ) as SeenBits;
      });
      apply(next);
    },
    get: (id: string) => states.get(id),
    unseenCount: () => [...states.values()].filter((s) => s === UNSEEN_AND_UNREAD).length,
    unreadCount: () => [...states.values()].filter((s) => s !== SEEN_AND_READ).length,
    on(type: 'seen' | 'read', listener: Listener) {
      listeners[type].add(listener);
      return () => listeners[type].delete(listener);
    },
  };
}

export type SeenStore = ReturnType<typeof createSeenStore>;

// ---- "thin client": server chỉ gửi id cho thông báo client đã có ----

export interface FullRow {
  id: string;
  text: string;
  time: number;
  state: SeenBits;
}
/** Hàng rút gọn: server biết client đã có nội dung, chỉ gửi id và trạng thái mới. */
export interface CachedRow {
  id: string;
  cached: true;
  state: SeenBits;
}
export type ServerRow = FullRow | CachedRow;

export const isCached = (row: ServerRow): row is CachedRow => 'cached' in row;

/**
 * Refetch đầu danh sách: ghép hàng rút gọn với bản đầy đủ đang có.
 * Bản gốc lặng lẽ bỏ hàng rút gọn không tìm thấy trong cache; ở đây trả `missing`
 * để gọi lại server lấy bản đầy đủ thay vì làm mất thông báo.
 */
export function mergeRefetch(current: FullRow[], incoming: ServerRow[]) {
  const byId = new Map(current.map((row) => [row.id, row]));
  const rows: FullRow[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  for (const row of incoming) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (!isCached(row)) {
      rows.push(row);
      continue;
    }
    const old = byId.get(row.id);
    if (old) rows.push({ ...old, state: row.state });
    else missing.push(row.id);
  }
  return { rows, missing };
}

/** Phân trang tiếp (after = endCursor): nối vào cuối, khử trùng theo id. */
export function appendPage(current: FullRow[], page: FullRow[]) {
  const ids = new Set(current.map((r) => r.id));
  return [...current, ...page.filter((r) => !ids.has(r.id))];
}

/** Ước lượng số byte JSON, để demo so sánh hàng đầy đủ với hàng rút gọn. */
export const jsonBytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;

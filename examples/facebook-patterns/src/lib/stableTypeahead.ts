/**
 * Typeahead không nhảy: cache kết quả theo tiền tố, ghép nhiều nguồn mà không đẩy mục
 * đã hiện xuống dưới, và cuộn bằng phím mà hover không "cướp" mục đang chọn.
 * Ý tưởng học từ CometSearchTypeaheadBaseQueryDataCacheProvider, CompositeSearchSource,
 * SUITokenizerItemListScroller của Facebook; viết lại từ đầu.
 */

// ---------------------------------------------------------------- 1. cache tiền tố

/** Chuẩn hoá MỘT chỗ duy nhất, cho cả lúc ghi lẫn lúc đọc cache. */
export function normalizeQuery(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Mặc định: mỗi từ của query là tiền tố của một từ trong nhãn ("an ng" khớp "Nguyễn An"). */
export function wordPrefixMatch(label: string, query: string): boolean {
  const words = normalizeQuery(label).split(' ');
  return query.split(' ').every((q) => words.some((w) => w.startsWith(q)));
}

export interface PrefixCacheOptions<T> {
  id: (e: T) => string;
  label: (e: T) => string;
  /**
   * Phải "đơn điệu": khớp query dài thì cũng khớp mọi tiền tố của nó.
   * Nhờ vậy kết quả của "ngu" luôn nằm trong kết quả của "ng" và thu hẹp được.
   */
  matches?: (label: string, normalizedQuery: string) => boolean;
  /** Mô phỏng bản gốc: ghi bằng trimStart, đọc bằng trim. */
  legacyKeys?: boolean;
}

export type CacheHit<T> = { entries: T[]; via: 'exact' | 'narrowed' | 'miss'; from?: string };

export class PrefixCache<T> {
  private map = new Map<string, T[]>();
  constructor(private o: PrefixCacheOptions<T>) {}

  private writeKey(q: string) {
    return this.o.legacyKeys ? q.trimStart().toLowerCase() : normalizeQuery(q);
  }
  private readKey(q: string) {
    return this.o.legacyKeys ? q.trim().toLowerCase() : normalizeQuery(q);
  }

  /** Tiền tố dài nhất (ngắn hơn key) đã có trong cache. */
  private longestPrefix(key: string): string | undefined {
    for (let n = key.length - 1; n > 0; n--) {
      const p = key.slice(0, n);
      if (this.map.has(p)) return p;
    }
    return undefined;
  }

  private narrow(prefix: string, key: string): T[] {
    const match = this.o.matches ?? wordPrefixMatch;
    return (this.map.get(prefix) ?? []).filter((e) => match(this.o.label(e), key));
  }

  match(query: string): CacheHit<T> {
    const key = this.readKey(query);
    const hit = this.map.get(key);
    if (hit) return { entries: hit, via: 'exact' };
    const prefix = this.longestPrefix(key);
    if (prefix === undefined) return { entries: [], via: 'miss' };
    const entries = this.narrow(prefix, key);
    this.map.set(key, entries); // lần sau gõ lại là trúng ngay
    return { entries, via: 'narrowed', from: prefix };
  }

  /** Kết quả mạng: trộn sau kết quả đã thu hẹp (mục đã hiện giữ nguyên vị trí), bỏ trùng theo id. */
  add(query: string, fromNetwork: T[]) {
    const key = this.writeKey(query);
    const prefix = this.map.has(key) ? key : this.longestPrefix(key);
    const base = prefix === undefined ? [] : prefix === key ? this.map.get(key)! : this.narrow(prefix, key);
    const seen = new Set(base.map(this.o.id));
    this.map.set(key, [...base, ...fromNetwork.filter((e) => !seen.has(this.o.id(e)))]);
  }

  keys() {
    return [...this.map.keys()];
  }
  clear() {
    this.map.clear();
  }
}

// ---------------------------------------------------------------- 2. ghép nhiều nguồn

/** pending: chưa trả lần nào; active: đã có một phần, còn chờ mạng; complete: xong. */
export type SourceStatus = 'pending' | 'active' | 'complete';
export interface SourceSnapshot<T> {
  status: SourceStatus;
  results: T[];
}

export interface ComposeOptions {
  /** cho phép nguồn dưới hiện trước rồi bị đẩy xuống ("allowClownyReflow" ở bản gốc) */
  allowReflow?: boolean;
  /** Mô phỏng bản gốc: nguồn chưa trả lần nào không được coi là "còn chạy". */
  legacyPending?: boolean;
}

export function composeResults<T>(
  snaps: readonly SourceSnapshot<T>[],
  id: (e: T) => string,
  o: ComposeOptions = {},
): { results: T[]; status: 'active' | 'complete'; emit: boolean } {
  const seen = new Set<string>();
  const results: T[] = [];
  for (const s of snaps)
    for (const e of s.results) {
      const k = id(e);
      if (!seen.has(k)) {
        seen.add(k);
        results.push(e);
      }
    }
  const status = snaps.every((s) => s.status === 'complete') ? 'complete' : 'active';
  if (o.allowReflow) return { results, status, emit: true };
  // nguồn đầu tiên chưa xong: mọi nguồn bên dưới nó phải chờ, nếu không sẽ bị đẩy xuống
  const firstOpen = snaps.findIndex((s) => (o.legacyPending ? s.status === 'active' : s.status !== 'complete'));
  const blocked = firstOpen !== -1 && snaps.slice(firstOpen + 1).some((s) => s.results.length > 0);
  return { results, status, emit: !blocked };
}

// ---------------------------------------------------------------- 3. cuộn bằng phím

const locks = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Cuộn để `item` nằm giữa `list`. Trong lúc nội dung trượt dưới con trỏ chuột đứng yên,
 * trình duyệt bắn mouseover/mouseenter; tắt pointer-events một nhịp ngắn để hover không
 * đổi mục đang chọn bằng phím.
 */
export function scrollItemToCenter(list: HTMLElement, item: HTMLElement, lockMs = 100) {
  // list cần position: relative để item.offsetTop tính từ đầu list
  const top = Math.max(0, item.offsetTop - (list.clientHeight - item.offsetHeight) / 2);
  if (Math.abs(list.scrollTop - top) < 1) return;
  if (lockMs > 0) {
    list.style.pointerEvents = 'none';
    clearTimeout(locks.get(list));
    locks.set(
      list,
      setTimeout(() => {
        list.style.pointerEvents = ''; // trả về giá trị của stylesheet, không ghi đè "all"
        locks.delete(list);
      }, lockMs),
    );
  }
  list.scrollTop = top;
}

/** Gọi khi unmount: huỷ timer VÀ trả lại pointer-events. */
export function releaseScrollLock(list: HTMLElement) {
  clearTimeout(locks.get(list));
  locks.delete(list);
  list.style.pointerEvents = '';
}

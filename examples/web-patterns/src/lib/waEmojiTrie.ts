/**
 * Emoticon → emoji khi gõ (trie đọc ngược) và tìm emoji theo từ khoá (trie tiền tố 5 ký tự).
 * Viết lại từ ý tưởng của WhatsApp Web 2020 (module eajcbddhd, ddajgjdcjb, ccgeihgjja, dideejhcch).
 */

/** Nút trie dùng chung cho cả hai việc. */
export class TrieNode<V> {
  readonly children = new Map<string, TrieNode<V>>();
  /** Giá trị của các khoá kết thúc đúng tại nút này. */
  readonly values: V[] = [];

  child(ch: string): TrieNode<V> {
    let next = this.children.get(ch);
    if (!next) this.children.set(ch, (next = new TrieNode<V>()));
    return next;
  }

  /** Mọi giá trị trong cây con, theo thứ tự chèn của từng nút (DFS). */
  collect(out: V[] = []): V[] {
    out.push(...this.values);
    for (const c of this.children.values()) c.collect(out);
    return out;
  }

  size(): number {
    let n = 1;
    for (const c of this.children.values()) n += c.size();
    return n;
  }
}

/** Cùng 17 emoticon như bản gốc. */
export const EMOTICONS: Record<string, string> = {
  '(y)': '👍', '(Y)': '👍', '(n)': '👎', '(N)': '👎',
  ':-)': '🙂', ':-(': '🙁', ':-p': '😛', ':-P': '😛',
  ':-|': '😐', ':-\\': '😕', ':-D': '😀', ':-*': '😘',
  ':-o': '😮', '<3': '❤️', '^_^': '😁', '>_<': '😆', ';-)': '😉',
};

/** Khoá được chèn NGƯỢC: ký tự cuối của emoticon là cạnh đầu tiên từ gốc. */
export function buildBackwardTrie(map: Record<string, string>): TrieNode<string> {
  const root = new TrieNode<string>();
  for (const [key, emoji] of Object.entries(map)) {
    let node = root;
    for (let i = key.length - 1; i >= 0; i--) node = node.child(key[i]);
    node.values.push(emoji);
  }
  return root;
}

/** Đang ở trong khối ``` chưa đóng? (số dấu ``` phía trước con trỏ là số lẻ) */
export function isInsideCodeBlock(textBefore: string): boolean {
  return (textBefore.split('```').length - 1) % 2 === 1;
}

export interface EmoticonMatch {
  /** Vị trí bắt đầu emoticon trong `textBefore + typed`. */
  start: number;
  original: string;
  emoji: string;
}

export interface MatchOptions {
  /** Chỉ thay khi trước emoticon là đầu dòng/khoảng trắng (bản gốc không kiểm, "abc(y)" cũng bị thay). */
  requireBoundary?: boolean;
  /** Lấy khớp dài nhất (bản gốc dừng ở lá đầu tiên, không hỗ trợ khoá là tiền tố của khoá khác). */
  longest?: boolean;
}

/**
 * Gọi TRƯỚC khi ký tự `typed` được chèn (sự kiện beforeinput): chỉ cần đi lùi từ `typed`
 * qua vài ký tự phía trước, không quét lại cả ô soạn tin.
 */
export function matchEmoticon(
  trie: TrieNode<string>,
  textBefore: string,
  typed: string,
  { requireBoundary = true, longest = true }: MatchOptions = {},
): EmoticonMatch | null {
  const s = textBefore + typed;
  let node: TrieNode<string> | undefined = trie;
  let best: EmoticonMatch | null = null;
  for (let i = s.length - 1; i >= 0 && s[i] !== '\n'; i--) {
    node = node.children.get(s[i]);
    if (!node) break;
    if (node.values.length) {
      const boundaryOk = !requireBoundary || i === 0 || /\s/.test(s[i - 1]);
      if (boundaryOk) best = { start: i, original: s.slice(i), emoji: node.values[0] };
      if (!longest) break;
    }
  }
  if (!best || isInsideCodeBlock(textBefore)) return null;
  return best;
}

/** Bản ghi để Backspace ngay sau emoji trả lại emoticon. */
export interface Replacement {
  start: number;
  emoji: string;
  original: string;
}

/** Backspace ngay sau emoji vừa thay → khôi phục chữ gốc (null nếu con trỏ không ở đó). */
export function undoReplacement(
  text: string,
  caret: number,
  rec: Replacement | null,
): { text: string; caret: number } | null {
  if (!rec || caret !== rec.start + rec.emoji.length) return null;
  if (text.slice(rec.start, caret) !== rec.emoji) return null;
  return {
    text: text.slice(0, rec.start) + rec.original + text.slice(caret),
    caret: rec.start + rec.original.length,
  };
}

/** Bản gốc áp màu da đã chọn cho emoji nhận màu da (ở đây chỉ 👍 👎). */
const SKIN_TONE_BASES = new Set(['👍', '👎']);
export function applySkinTone(emoji: string, tone: string | null): string {
  return tone && SKIN_TONE_BASES.has(emoji) ? emoji + tone : emoji;
}

// ---------------- Tìm emoji theo từ khoá ----------------

export interface KeywordEntry {
  emoji: string;
  keyword: string;
}

export interface RankContext {
  recent?: string[];
  popular?: string[];
  /** emoji → thứ tự trong bảng chọn (nhóm mặt cười trước, cờ sau). */
  categoryOrder?: Map<string, number>;
}

/** Chữ thường, bỏ dấu: "Mèo Đen" → "meo den" (bản gốc chỉ toLowerCase). */
export function foldKeyword(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd').trim();
}

export class EmojiSearchIndex {
  private readonly root = new TrieNode<KeywordEntry>();
  readonly entries: KeywordEntry[];

  /** `dicts`: từ khoá → emoji theo từng locale; dict sau ghi đè dict trước (vd en rồi vi). */
  constructor(
    dicts: Record<string, string>[],
    readonly prefixLength = 5,
    private readonly fold: (s: string) => string = foldKeyword,
  ) {
    const merged: Record<string, string> = Object.assign({}, ...dicts);
    this.entries = Object.entries(merged).map(([k, emoji]) => ({ emoji, keyword: fold(k) }));
    for (const entry of this.entries) {
      let node = this.root;
      for (const ch of entry.keyword.slice(0, prefixLength)) node = node.child(ch);
      node.values.push(entry);
    }
  }

  get nodeCount(): number {
    return this.root.size();
  }

  /** Ứng viên: đi tới nút của tiền tố (tối đa prefixLength ký tự), lấy cả cây con, lọc phần còn lại. */
  matches(query: string): KeywordEntry[] {
    const q = this.fold(query);
    if (!q) return [];
    let node: TrieNode<KeywordEntry> | undefined = this.root;
    for (const ch of q.slice(0, this.prefixLength)) {
      node = node.children.get(ch);
      if (!node) return [];
    }
    const found = node.collect();
    return q.length > this.prefixLength ? found.filter((e) => e.keyword.startsWith(q)) : found;
  }

  /** Xếp hạng như bản gốc: khớp đúng + hay dùng → khớp đúng → gần đây → phổ biến → còn lại. */
  search(query: string, { recent = [], popular = [], categoryOrder }: RankContext = {}): string[] {
    const q = this.fold(query);
    const found = this.matches(q);
    const all = new Set(found.map((e) => e.emoji));
    const exact = new Set(found.filter((e) => e.keyword === q).map((e) => e.emoji));
    const byCategory = (set: Iterable<string>) =>
      [...set].sort(
        (a, b) =>
          (categoryOrder?.get(a) ?? Number.MAX_SAFE_INTEGER) - (categoryOrder?.get(b) ?? Number.MAX_SAFE_INTEGER),
      );
    const recentHit = recent.filter((e) => all.has(e));
    const popularHit = popular.filter((e) => all.has(e));
    const exactFavorite = [...recentHit, ...popularHit].filter((e) => exact.has(e));
    return [...new Set([...exactFavorite, ...byCategory(exact), ...recentHit, ...popularHit, ...byCategory(all)])];
  }
}

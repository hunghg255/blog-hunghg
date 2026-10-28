/**
 * Cửa sổ render tin nhắn theo "chiều cao ước lượng", kiểu WhatsApp Web 2020
 * (module `jcfhjhibi` RenderCursor + `bdecdecede` ước lượng chiều cao + `djdhjggcbi` innerHeight).
 *
 * Không đo DOM: mỗi tin có một chiều cao đoán trước theo loại tin. Cửa sổ là
 * {focusedId, before, after}; loadBefore/loadAfter thêm vừa đủ tin để lấp `viewport × factor` px.
 * Cursor bất biến: mỗi thao tác trả về cursor mới, nên có thể so sánh bằng === trong React.
 *
 * Khác bản gốc: sửa lỗi thứ tự toán tử (ảnh ra NaN, location tĩnh bị tính như live, mất phần
 * quote/caption), gom album bằng albumId, và tra vị trí tin bằng Map thay cho indexOf.
 */

export type MsgType =
  | 'chat'
  | 'notification'
  | 'image'
  | 'video'
  | 'gif'
  | 'ptt'
  | 'location'
  | 'vcard'
  | 'document'
  | 'sticker'
  | 'unknown';

export interface MsgLike {
  id: string;
  type: MsgType;
  fromMe: boolean;
  /** tác giả trong group; 1:1 thì bỏ trống */
  author?: string;
  body?: string;
  quoted?: boolean;
  caption?: string;
  linkPreview?: boolean;
  width?: number;
  height?: number;
  isLive?: boolean;
  /** các tin liên tiếp cùng albumId được vẽ thành một lưới */
  albumId?: string;
}

export const HEIGHTS = {
  quoted: 54,
  caption: 31,
  linkPreview: 53,
  textLine: 19,
  textPadding: 13,
  charsPerLine: 100,
  imageMax: 330,
  video: 166,
  gif: 137,
  ptt: 67,
  vcard: 74,
  document: 188,
  sticker: 125,
  locationLive: 220,
  locationStatic: 150,
  authorName: 19,
  sameSenderGap: 2,
  otherSenderGap: 12,
} as const;

const codepoints = (s = '') => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Chiều cao đoán trước (px) của một bong bóng tin, chưa tính khoảng cách giữa các tin. */
export function estimateHeight(m: MsgLike): number {
  // Phần cộng thêm luôn được cộng SAU khi tính phần thân, không trộn vào điều kiện.
  const extra = (m.quoted ? HEIGHTS.quoted : 0) + (m.caption ? HEIGHTS.caption : 0);
  return extra + bodyHeight(m);
}

function bodyHeight(m: MsgLike): number {
  switch (m.type) {
    case 'chat':
    case 'notification': {
      const lines = Math.ceil(codepoints(m.body) / HEIGHTS.charsPerLine);
      return (m.linkPreview ? HEIGHTS.linkPreview : 0) + HEIGHTS.textLine * lines + HEIGHTS.textPadding;
    }
    case 'image':
      return m.width && m.height
        ? Math.floor(Math.min((HEIGHTS.imageMax / m.width) * m.height, HEIGHTS.imageMax))
        : HEIGHTS.imageMax;
    case 'video':
      return HEIGHTS.video;
    case 'gif':
      return HEIGHTS.gif;
    case 'ptt':
      return HEIGHTS.ptt;
    case 'location':
      return m.isLive ? HEIGHTS.locationLive : HEIGHTS.locationStatic;
    case 'vcard':
      return HEIGHTS.vcard;
    case 'document':
      return HEIGHTS.document;
    case 'sticker':
      return HEIGHTS.sticker;
    default:
      return 0;
  }
}

export type Estimate = (m: MsgLike) => number;
export type Gap = (prev: MsgLike | undefined, cur: MsgLike, group: boolean) => number;

/** Khoảng cách phía trên tin `cur` khi tin liền kề theo hướng duyệt là `prev`. */
export function gapBefore(prev: MsgLike | undefined, cur: MsgLike, group: boolean): number {
  if (group) {
    const author = cur.fromMe ? 'me' : cur.author;
    const prevAuthor = prev && (prev.fromMe ? 'me' : prev.author);
    const nameRow = !cur.fromMe && author !== prevAuthor ? HEIGHTS.authorName : 0;
    return nameRow + (author === prevAuthor ? HEIGHTS.sameSenderGap : HEIGHTS.otherSenderGap);
  }
  // Bản gốc so `2*isNotification + isSentByMe` và đòi giá trị khác 0, nên hai tin đến liên tiếp
  // luôn cách 12px; ở đây "cùng phía" là đủ.
  const side = (m: MsgLike) => (m.type === 'notification' ? 'n' : m.fromMe ? 'me' : 'them');
  return prev && side(prev) === side(cur) ? HEIGHTS.sameSenderGap : HEIGHTS.otherSenderGap;
}

export interface FillOptions {
  /** chiều cao cần lấp (px) */
  budget: number;
  maxCount?: number;
  group?: boolean;
  albumMinSize?: number;
  estimate?: Estimate;
  gap?: Gap;
}

/**
 * Đếm bao nhiêu tin, bắt đầu từ `start` và đi theo `dir`, thì đủ lấp `budget` px.
 * Album đủ lớn được tính như một khối có chiều cao của tin đầu.
 */
export function countToFill(list: readonly MsgLike[], start: number, dir: -1 | 1, opts: FillOptions): number {
  const { budget, maxCount = Infinity, group = false, albumMinSize = 4, estimate = estimateHeight, gap = gapBefore } = opts;
  let used = 0;
  let count = 0;
  let prev: MsgLike | undefined;
  for (let i = start; i >= 0 && i < list.length && count < maxCount; ) {
    const m = list[i];
    let height = estimate(m);
    let size = 1;
    if (m.albumId) {
      while (count + size < maxCount && list[i + dir * size]?.albumId === m.albumId) size++;
      // Album nhỏ hơn ngưỡng vẫn vẽ từng ảnh riêng, nên cộng đủ từng tin.
      if (size < albumMinSize) for (let k = 1; k < size; k++) height += estimate(list[i + dir * k]);
    }
    used += gap(prev, m, group) + height;
    count += size;
    i += dir * size;
    prev = m;
    if (used > budget) break;
  }
  return count;
}

export interface CursorInit {
  focusedId?: string;
  before?: number;
  after?: number;
}

export interface LoadOptions {
  /** viewport tính bằng px (bản gốc: window.innerHeight cache, cập nhật khi resize sau 500ms) */
  viewport: number;
  factor?: number;
  count?: number;
  maxCount?: number;
  group?: boolean;
  estimate?: Estimate;
  gap?: Gap;
}

/** Vị trí của tin trong list; dùng Map dựng một lần thay cho indexOf O(n) mỗi lần gọi. */
export class MessageIndex {
  private readonly pos = new Map<string, number>();
  constructor(readonly items: readonly MsgLike[]) {
    items.forEach((m, i) => this.pos.set(m.id, i));
  }
  get length() {
    return this.items.length;
  }
  indexOf(id: string | undefined) {
    return id === undefined ? -1 : (this.pos.get(id) ?? -1);
  }
}

export class RenderCursor {
  readonly focusedId?: string;
  readonly before: number;
  readonly after: number;

  constructor({ focusedId, before = 0, after = 0 }: CursorInit = {}) {
    this.focusedId = focusedId;
    this.before = before;
    this.after = after;
  }

  /** Cửa sổ ban đầu: lấp đúng một màn hình mỗi phía của tin focus (tin mới nhất nếu không có). */
  static create(list: MessageIndex, opts: LoadOptions & { focusedId?: string }) {
    return new RenderCursor({ focusedId: opts.focusedId })
      .loadBefore(list, { ...opts, factor: 1 })
      .loadAfter(list, { ...opts, factor: 1 });
  }

  /** Tin focus không còn trong list (bị xoá) thì neo về tin mới nhất ở đáy. */
  focusIndex(list: MessageIndex) {
    const i = list.indexOf(this.focusedId);
    return i === -1 ? list.length - 1 : i;
  }

  getStart(list: MessageIndex) {
    return Math.max(this.focusIndex(list) - this.before, 0);
  }

  getEnd(list: MessageIndex) {
    return Math.min(this.focusIndex(list) + this.after + 1, list.length);
  }

  hasBefore(list: MessageIndex) {
    return this.getStart(list) > 0;
  }

  hasAfter(list: MessageIndex) {
    return this.getEnd(list) < list.length;
  }

  slice(list: MessageIndex) {
    return list.items.slice(this.getStart(list), this.getEnd(list));
  }

  loadBefore(list: MessageIndex, opts: LoadOptions) {
    const n = opts.count || this.fill(list, this.getStart(list) - 1, -1, opts);
    return n ? new RenderCursor({ ...this, before: this.before + n }) : this;
  }

  loadAfter(list: MessageIndex, opts: LoadOptions) {
    const n = opts.count || this.fill(list, this.getEnd(list), 1, opts);
    return n ? new RenderCursor({ ...this, after: this.after + n }) : this;
  }

  /** Về lại đáy: chỉ giữ phần "before" đủ lấp `factor` màn hình tính ngược từ tin cuối cửa sổ. */
  resetBefore(list: MessageIndex, opts: LoadOptions) {
    const keep = this.fill(list, this.getEnd(list) - 1, -1, opts);
    return keep < this.before ? new RenderCursor({ ...this, before: keep }) : this;
  }

  private fill(list: MessageIndex, start: number, dir: -1 | 1, opts: LoadOptions) {
    const { viewport, factor = 2, ...rest } = opts;
    return countToFill(list.items, start, dir, { ...rest, budget: viewport * factor });
  }
}

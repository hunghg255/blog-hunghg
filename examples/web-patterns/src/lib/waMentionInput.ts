/**
 * Mention trong ô soạn tin: lưu bằng token zero-width, đếm giới hạn theo code point.
 * Viết lại từ ý tưởng của WhatsApp Web 2020 (module ecddiajibj: plugin mention, igieaiddf: BaseInput).
 */

export const ZW = '\u200B';
/** Dạng lưu trong ô soạn tin / bản nháp: ZW + jid + ZW. */
export const MENTION_RE = /\u200B(\d+@c\.us)\u200B/g;

export type Segment = { type: 'text'; text: string } | { type: 'mention'; jid: string };
export type NameOf = (jid: string) => string | undefined;

export const encodeMention = (jid: string) => ZW + jid + ZW;
export const phoneOf = (jid: string) => jid.split('@')[0];

/** Chuỗi lưu → các đoạn chữ/mention. */
export function parseStored(stored: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of stored.matchAll(MENTION_RE)) {
    if (m.index > last) out.push({ type: 'text', text: stored.slice(last, m.index) });
    out.push({ type: 'mention', jid: m[1] });
    last = m.index + m[0].length;
  }
  if (last < stored.length) out.push({ type: 'text', text: stored.slice(last) });
  return out;
}

/** Nhãn hiện cho người dùng. Không có trong danh bạ thì hiện số, KHÔNG trả lại jid thô. */
export function mentionLabel(jid: string, nameOf: NameOf): string {
  return nameOf(jid) ?? '+' + phoneOf(jid);
}

/** Dạng gửi đi: "@<số>" trong thân tin + danh sách jid được nhắc (bên nhận tự đổi số thành tên). */
export function toWire(stored: string): { body: string; mentionedJids: string[] } {
  const jids = new Set<string>();
  const body = stored.replace(MENTION_RE, (_, jid: string) => {
    jids.add(jid);
    return '@' + phoneOf(jid);
  });
  return { body, mentionedJids: [...jids] };
}

/** Bên nhận: "@<số>" có trong mentionedJids → token zero-width (để render thành chip). */
export function fromWire(body: string, mentionedJids: string[]): string {
  const known = new Set(mentionedJids.map(phoneOf));
  return body.replace(/@(\d{5,})/g, (all, phone: string) => (known.has(phone) ? encodeMention(phone + '@c.us') : all));
}

// ---------------- Đếm độ dài ----------------

/** Số code point (cặp surrogate tính là 1), không cấp phát mảng như [...s].length. */
export function countCodePoints(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
      const p = s.charCodeAt(i - 1);
      if (p >= 0xd800 && p <= 0xdbff) continue;
    }
    n++;
  }
  return n;
}

const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter() : null;
/** Số "ký tự người dùng thấy" (grapheme), chỉ để hiển thị. */
export function countGraphemes(s: string): number {
  if (!graphemes) return countCodePoints(s);
  let n = 0;
  for (const _ of graphemes.segment(s)) n++;
  return n;
}

/** Cắt theo code point, không bao giờ cắt đôi cặp surrogate. */
export function sliceCodePoints(s: string, max: number): string {
  if (max <= 0) return '';
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const isLow = c >= 0xdc00 && c <= 0xdfff && i > 0 && s.charCodeAt(i - 1) >= 0xd800 && s.charCodeAt(i - 1) <= 0xdbff;
    if (!isLow && ++n > max) return s.slice(0, i);
  }
  return s;
}

/** Còn được thêm bao nhiêu code point nếu thay vùng chọn bằng chữ mới. */
export function remaining(maxLength: number, currentLength: number, selectionLength: number): number {
  return maxLength + selectionLength - currentLength;
}

// ---------------- Kích hoạt gợi ý mention ----------------

/** Chữ/số ở mọi ngôn ngữ ("ạ", "é" cũng là chữ), khác \W của bản gốc chỉ hiểu ASCII. */
const WORD = /[\p{L}\p{N}_]/u;

/**
 * Tìm "@truy vấn" ngay trước con trỏ. "@" phải ở đầu dòng hoặc sau ký tự không phải chữ,
 * truy vấn không có xuống dòng và không dài quá maxQuery.
 */
export function findMentionQuery(textBefore: string, maxQuery = 50): { at: number; query: string } | null {
  for (let i = textBefore.length - 1; i >= 0 && textBefore.length - i <= maxQuery + 1; i--) {
    const ch = textBefore[i];
    if (ch === '\n' || ch === ZW) return null;
    if (ch !== '@') continue;
    const prev = i > 0 ? textBefore[i - 1] : '';
    if (prev && WORD.test(prev)) return null; // email: an@gmail
    return { at: i, query: textBefore.slice(i + 1) };
  }
  return null;
}

// ---------------- DOM của ô soạn tin (contentEditable) ----------------

/** Chip mention: contentEditable=false nên con trỏ không lọt vào trong, Backspace xoá cả khối. */
export function createMentionChip(jid: string, nameOf: NameOf): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'wa-mention-chip';
  chip.contentEditable = 'false';
  chip.dataset.jid = jid;
  const at = document.createElement('span');
  at.textContent = '@';
  const name = document.createElement('bdi'); // tên tiếng Ả Rập không đảo thứ tự chữ xung quanh
  name.textContent = mentionLabel(jid, nameOf);
  chip.append(at, name);
  return chip;
}

/** DOM → chuỗi lưu. Chip thành token zero-width, <br> và khối <div> thành "\n". */
export function serializeNode(root: Node): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? '').replaceAll(ZW, '').replaceAll('\u00A0', ' ');
      return;
    }
    if (!(node instanceof HTMLElement || node instanceof DocumentFragment)) return;
    if (node instanceof HTMLElement) {
      if (node.dataset.jid) {
        out += encodeMention(node.dataset.jid);
        return;
      }
      if (node.tagName === 'BR') {
        out += '\n';
        return;
      }
      if (node.tagName === 'DIV' && out && !out.endsWith('\n')) out += '\n';
    }
    node.childNodes.forEach(walk);
  };
  walk(root);
  return out;
}

/** Chuỗi lưu → nội dung của ô soạn tin. */
export function renderStored(root: HTMLElement, stored: string, nameOf: NameOf): void {
  root.replaceChildren(
    ...parseStored(stored).map((s) =>
      s.type === 'text' ? document.createTextNode(s.text) : createMentionChip(s.jid, nameOf),
    ),
  );
}

/** Thay "@truy vấn" trong text node bằng chip + một dấu cách, đặt con trỏ sau dấu cách. */
export function insertMention(textNode: Text, at: number, caret: number, jid: string, nameOf: NameOf): void {
  const range = document.createRange();
  range.setStart(textNode, at);
  range.setEnd(textNode, caret);
  range.deleteContents();
  const space = document.createTextNode('\u00A0');
  range.insertNode(space);
  range.insertNode(createMentionChip(jid, nameOf));
  const sel = getSelection();
  sel?.removeAllRanges();
  const after = document.createRange();
  after.setStartAfter(space);
  after.collapse(true);
  sel?.addRange(after);
}

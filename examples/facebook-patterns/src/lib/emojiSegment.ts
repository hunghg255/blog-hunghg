/**
 * Tách cụm emoji trong chuỗi (ý tưởng từ EmojiRenderer của Facebook).
 *
 * Một "emoji" người dùng thấy có thể là nhiều code point:
 *   👩🏽‍💻 = 👩 + 🏽 (màu da) + ZWJ + 💻
 *   🇻🇳   = hai regional indicator
 *   1️⃣   = '1' + VS16 + U+20E3 (keycap)
 *   🏴󠁧󠁢󠁳󠁣󠁴󠁿  = 🏴 + chuỗi tag + cancel tag
 * Facebook duyệt từng code point bằng một máy trạng thái. Bản này giữ cấu trúc đó nhưng
 * dùng Unicode property escape thay cho bảng dữ liệu sinh sẵn.
 */

export interface EmojiMatch {
  /** các code point (dạng chuỗi) của cụm */
  parts: string[];
  /** vị trí và độ dài theo đơn vị UTF-16, để cắt chuỗi gốc */
  offset: number;
  length: number;
}

const RE = {
  regional: /^\p{Regional_Indicator}$/u,
  modifierBase: /^\p{Emoji_Modifier_Base}$/u,
  modifier: /^\p{Emoji_Modifier}$/u,
  pictographic: /^\p{Extended_Pictographic}$/u,
  // ký tự "text" có thể thành emoji khi đi kèm VS16/keycap: # * 0-9 © ® ‼ …
  textEmoji: /^[#*0-9\u00a9\u00ae\u203c\u2049\u2122\u2139\u2194-\u2199\u21a9\u21aa]$/u,
  combining: /^[\u0300-\u036f\u20d0-\u20ff]$/u, // gồm U+20E3 keycap
};
const ZWJ = 0x200d;
const VS16 = 0xfe0f;
const VS15 = 0xfe0e;
const isTagSpec = (cp: number) => cp >= 0xe0020 && cp <= 0xe007e;
const TAG_TERM = 0xe007f;

/** Trạng thái giống bản gốc (đặt tên thay cho số 0–11). */
type State =
  | 'emoji' // vừa gặp emoji thường
  | 'combining' // sau dấu kết hợp (keycap)
  | 'vs16' // sau VS16
  | 'flagDone' // đã đủ cặp regional indicator
  | 'modifierBase' // emoji nhận được màu da
  | 'modified' // đã gắn màu da
  | 'tag' // đang trong chuỗi tag (cờ Scotland…)
  | 'zwj' // vừa gặp ZWJ, chờ emoji nối tiếp
  | 'none' // ngoài emoji
  | 'regional' // mới có một regional indicator
  | 'text' // ký tự text có thể thành emoji (#, 0-9…)
  | 'vs15'; // VS15: ép hiển thị dạng chữ

function startState(ch: string): State {
  if (RE.regional.test(ch)) return 'regional';
  if (RE.modifierBase.test(ch)) return 'modifierBase';
  if (RE.textEmoji.test(ch)) return 'text';
  if (RE.pictographic.test(ch)) return 'emoji';
  return 'none';
}

function afterEmoji(cp: number, ch: string): State {
  if (cp === ZWJ) return 'zwj';
  if (cp === VS16) return 'vs16';
  if (cp === VS15) return 'vs15';
  if (RE.combining.test(ch)) return 'combining';
  if (isTagSpec(cp)) return 'tag';
  return 'none';
}

function step(state: State, cp: number, ch: string): State {
  switch (state) {
    case 'regional':
      return RE.regional.test(ch) ? 'flagDone' : 'none';
    case 'modifierBase':
      if (RE.modifier.test(ch)) return 'modified';
      return afterEmoji(cp, ch);
    case 'emoji':
      return afterEmoji(cp, ch);
    case 'combining':
    case 'vs16':
      if (RE.combining.test(ch)) return state;
      return cp === ZWJ ? 'zwj' : isTagSpec(cp) ? 'tag' : 'none';
    case 'flagDone':
    case 'modified':
      return cp === ZWJ ? 'zwj' : isTagSpec(cp) ? 'tag' : 'none';
    case 'tag':
      return isTagSpec(cp) || cp === TAG_TERM ? 'tag' : 'none';
    case 'zwj':
      if (RE.regional.test(ch)) return 'regional';
      if (RE.modifierBase.test(ch)) return 'modifierBase';
      return RE.pictographic.test(ch) ? 'emoji' : 'none';
    case 'text':
      if (RE.combining.test(ch)) return 'combining';
      return cp === VS16 ? 'vs16' : 'none';
    default:
      return 'none';
  }
}

/**
 * Cụm có thật sự là emoji không? '#' hay '1' đứng một mình là chữ; chỉ thành emoji
 * khi có VS16 hoặc keycap. Một regional indicator lẻ cũng không tính.
 */
function isRealEmoji(parts: string[]) {
  const first = parts[0];
  if (!first) return false;
  if (parts.some((p) => p.codePointAt(0) === VS15)) return false;
  if (RE.textEmoji.test(first)) return parts.length > 1;
  if (RE.regional.test(first)) return parts.length >= 2;
  return true;
}

/** Tách các cụm emoji. `limit`: dừng sớm khi đã đủ số cụm (containsEmoji dùng limit = 1). */
export function parseEmoji(text: string, limit = Infinity): EmojiMatch[] {
  const out: EmojiMatch[] = [];
  let current: EmojiMatch | null = null;
  let state: State = 'none';
  let i = 0;
  while (i < text.length) {
    const cp = text.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    state = step(state, cp, ch);
    if (state === 'none') {
      // không nối được vào cụm cũ: đóng cụm cũ, xem ký tự này có mở cụm mới không
      if (current && isRealEmoji(current.parts)) out.push(current);
      current = null;
      if (out.length >= limit) return out;
      state = startState(ch);
      if (state !== 'none') current = { parts: [ch], offset: i, length: ch.length };
    } else if (current) {
      current.parts.push(ch);
      current.length += ch.length;
    }
    i += ch.length;
  }
  if (current && isRealEmoji(current.parts) && out.length < limit) out.push(current);
  return out;
}

export const containsEmoji = (text: string) => parseEmoji(text, 1).length === 1;
export const countEmoji = (text: string) => parseEmoji(text).length;

/** Thay mỗi cụm emoji bằng kết quả của `render` (vd thẻ <img>), giữ nguyên phần chữ. */
export function renderEmoji<T>(text: string, render: (m: EmojiMatch) => T): Array<string | T> {
  const out: Array<string | T> = [];
  let last = 0;
  for (const m of parseEmoji(text)) {
    if (m.offset > last) out.push(text.slice(last, m.offset));
    out.push(render(m));
    last = m.offset + m.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Khoá ảnh kiểu Facebook: mã hex các code point nối bằng '_', bỏ VS16. */
export function emojiImageKey(m: EmojiMatch) {
  return m.parts
    .map((p) => p.codePointAt(0)!)
    .filter((cp) => cp !== VS16)
    .map((cp) => cp.toString(16))
    .join('_');
}

/** Năm biến thể màu da cho emoji nhận được màu da (U+1F3FB…U+1F3FF). */
export function skinToneVariants(base: string) {
  if (!RE.modifierBase.test(base)) return [];
  return [0x1f3fb, 0x1f3fc, 0x1f3fd, 0x1f3fe, 0x1f3ff].map((m) => base + String.fromCodePoint(m));
}

// ---- Cách hiện đại: Intl.Segmenter tách grapheme, rồi lọc grapheme nào là emoji ----

// Grapheme là emoji khi: mặc định hiển thị dạng emoji, hoặc có VS16 / màu da / ZWJ / cờ / keycap.
// Chỉ \p{Extended_Pictographic} là chưa đủ: '©' hay '❤' mặc định là CHỮ nếu không có VS16.
const EMOJI_GRAPHEME =
  /\p{Emoji_Presentation}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D)|\p{Regional_Indicator}{2}|[#*0-9]\uFE0F?\u20E3/u;

export function parseEmojiIntl(text: string): EmojiMatch[] | null {
  if (typeof Intl === 'undefined' || !('Segmenter' in Intl)) return null;
  const seg = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const out: EmojiMatch[] = [];
  for (const s of seg.segment(text)) {
    if (EMOJI_GRAPHEME.test(s.segment) && !s.segment.includes('\uFE0E')) {
      out.push({ parts: Array.from(s.segment), offset: s.index, length: s.segment.length });
    }
  }
  return out;
}

/**
 * Cách ngây thơ hay gặp: đếm code point có thuộc tính \p{Emoji}. Sai hai kiểu: đếm lẻ từng mảnh
 * của một cụm (👩🏽‍💻 thành 3), và đếm cả '#', chữ số vì chúng cũng có thuộc tính Emoji.
 */
export function countEmojiNaive(text: string) {
  return Array.from(text).filter((ch) => /\p{Emoji}/u.test(ch)).length;
}

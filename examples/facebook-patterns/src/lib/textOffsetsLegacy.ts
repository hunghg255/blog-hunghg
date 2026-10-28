/**
 * Mô phỏng cách tính của bản gốc (đã đổi tên biến) để demo đặt cạnh bản sửa.
 * KHÔNG dùng trong dự án: mỗi hàm ở đây có một lỗi trộn đơn vị UTF-16 / code point.
 */
import { cpLength, graphemes, isEmojiGrapheme, REDDIT, URL_RE, type TextRange } from './textOffsets';

/** MentionsUtils: che ký tự astral bằng "_" để regex đếm theo code point, rồi lấy tên từ chuỗi đã che. */
export function legacyParseMentions(markup: string) {
  const re = /@\[([0-9;]+):((?:[^\\\]]|\\.)*)\]/g;
  let text = markup;
  let cps = Array.from(text);
  let masked = cps.map((c) => (c.length > 1 ? '_' : c)).join('');
  const ranges: TextRange<{ uid: string }>[] = [];
  for (let m = re.exec(masked); m; m = re.exec(masked)) {
    const name = m[2]; // lấy từ chuỗi ĐÃ CHE: emoji trong tên thành "_", "\]" giữ nguyên
    ranges.push({ offset: m.index, length: name.length, entity: { uid: m[1] } });
    masked = masked.slice(0, m.index) + name + masked.slice(m.index + m[0].length);
    text = cps.slice(0, m.index).join('') + name + cps.slice(m.index + m[0].length).join('');
    cps = Array.from(text);
    re.lastIndex = m.index + name.length;
  }
  return { text, ranges };
}

/** RedditLinkRanges: offset cộng dồn theo code point nhưng lại dùng làm chỉ số substr (UTF-16). */
export function legacyRedditRanges(text: string, from = 0): TextRange<{ url: string }>[] {
  const rest = text.substr(from);
  const m = new RegExp(REDDIT.source, 'i').exec(rest);
  if (!m) return [];
  const link = m[2];
  const start = from + cpLength(rest.substr(0, m.index + m[1].length));
  const url = 'https://reddit.com' + (link[0] === '/' ? '' : '/') + link;
  return [{ offset: start, length: link.length, entity: { url } }, ...legacyRedditRanges(text, start + link.length)];
}

/** getURLRanges: cùng lỗi, và gặp URL không hợp lệ thì dừng hẳn (break). */
export function legacyUrlRanges(text: string, isValid: (url: string) => boolean = () => true) {
  const out: TextRange<{ url: string }>[] = [];
  let pos = 0;
  for (;;) {
    const rest = text.substr(pos);
    const m = new RegExp(URL_RE.source, 'i').exec(rest);
    if (!m || !isValid(m[0])) break;
    pos += cpLength(rest.substr(0, rest.indexOf(m[0])));
    out.push({ offset: pos, length: m[0].length, entity: { url: m[0] } });
    pos += m[0].length;
  }
  return out;
}

/** MessengerSupportedEmojiUtils.getEmojiOnlyContents: emoticon chỉ được nhận khi đứng trước mọi emoji. */
export function legacyEmojiOnly(text: string): boolean {
  let rest = text;
  const eatSpace = () => (rest = rest.replace(/^\s+/, ''));
  for (;;) {
    eatSpace();
    const emo = /^(:\)|:\(|:D|;\)|<3|:P)/.exec(rest);
    if (!emo) break;
    rest = rest.slice(emo[0].length);
  }
  while (rest.trim().length > 0) {
    eatSpace();
    const g = graphemes(rest)[0];
    if (!isEmojiGrapheme(g)) return false;
    rest = rest.slice(g.length);
  }
  return true;
}

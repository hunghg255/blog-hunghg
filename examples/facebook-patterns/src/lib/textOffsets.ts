/**
 * Offset văn bản: chuỗi JavaScript đánh chỉ số theo đơn vị UTF-16, còn nhiều API
 * (entity range của Draft.js, GraphQL của Messenger) đếm theo code point.
 * Quy tắc của file này: mọi phép tìm/cắt làm trên UTF-16, chỉ đổi sang code point
 * MỘT lần ở cuối. Ý tưởng học từ lỗi trong MentionsUtils, RedditLinkRanges, getURLRanges
 * và MessengerSupportedEmojiUtils của Facebook; code viết lại từ đầu.
 */

export interface TextRange<E = unknown> {
  /** tính theo code point */
  offset: number;
  /** tính theo code point */
  length: number;
  entity: E;
}

// ---------------------------------------------------------------- đổi đơn vị

/** Số code point: "😀".length === 2 nhưng cpLength("😀") === 1. */
export function cpLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** Chỉ số UTF-16 -> offset code point. */
export const toCodePoint = (s: string, utf16Index: number) => cpLength(s.slice(0, utf16Index));

/** Offset code point -> chỉ số UTF-16. */
export function toUtf16(s: string, cpOffset: number): number {
  let i = 0;
  for (let n = 0; n < cpOffset && i < s.length; n++) {
    const c = s.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < s.length ? 2 : 1;
  }
  return i;
}

/** Cắt chuỗi theo offset code point (để kiểm tra range). */
export const cpSlice = (s: string, offset: number, length: number) =>
  s.slice(toUtf16(s, offset), toUtf16(s, offset + length));

/**
 * Quét mọi kết quả của một regex trên UTF-16, rồi đổi offset sang code point.
 * Không đệ quy, không substr: lastIndex của regex /g tự đi tiếp.
 */
export function scanRanges<E>(
  text: string,
  re: RegExp,
  pick: (m: RegExpExecArray) => { start: number; value: string; entity: E } | null,
): TextRange<E>[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out: TextRange<E>[] = [];
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (m[0] === '') g.lastIndex++; // regex khớp rỗng: tránh lặp vô hạn
    const hit = pick(m);
    if (!hit) continue;
    out.push({ offset: toCodePoint(text, hit.start), length: cpLength(hit.value), entity: hit.entity });
  }
  return out;
}

// ---------------------------------------------------------------- mention

/** Markup "@[uid:Tên]"; trong tên, "\]" và "\\" là ký tự thoát. */
const MENTION = /@\[([0-9;]+):((?:[^\\\]]|\\.)*)\]/g;

export function parseMentions(markup: string): { text: string; ranges: TextRange<{ uid: string }>[] } {
  let text = '';
  let last = 0;
  const ranges: TextRange<{ uid: string }>[] = [];
  for (const m of markup.matchAll(MENTION)) {
    const name = m[2].replace(/\\(.)/g, '$1'); // bỏ ký tự thoát
    text += markup.slice(last, m.index);
    ranges.push({ offset: cpLength(text), length: cpLength(name), entity: { uid: m[1] } });
    text += name;
    last = m.index! + m[0].length;
  }
  return { text: text + markup.slice(last), ranges };
}

// ---------------------------------------------------------------- link

/** r/sub hoặc u/user; tên subreddit tối đa 21 ký tự. */
export const REDDIT = /(^|\s)(\/?[ru]\/\w{1,21})\b/gi;

export function redditRanges(text: string): TextRange<{ url: string }>[] {
  return scanRanges(text, REDDIT, (m) => {
    const link = m[2];
    const start = m.index + m[1].length;
    return { start, value: link, entity: { url: 'https://reddit.com' + (link[0] === '/' ? '' : '/') + link } };
  });
}

/** URL giản lược cho demo: có hoặc không có scheme, tên miền có dấu chấm. */
export const URL_RE = /\b(?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi;

export function urlRanges(text: string, isValid: (url: string) => boolean = () => true): TextRange<{ url: string }>[] {
  return scanRanges(text, URL_RE, (m) => {
    // URL không hợp lệ: bỏ qua nó, KHÔNG dừng cả vòng lặp như bản gốc
    if (!isValid(m[0])) return null;
    const url = /^[a-z][a-z0-9+.-]+:\/\//i.test(m[0]) ? m[0] : 'http://' + m[0];
    return { start: m.index, value: m[0], entity: { url } };
  });
}

// ---------------------------------------------------------------- đếm

export interface TextCount {
  utf16: number;
  codePoints: number;
  /** "ký tự" theo mắt người: 👨‍👩‍👧 là 1 */
  graphemes: number;
}

const segmenter =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

export function graphemes(text: string): string[] {
  return segmenter ? Array.from(segmenter.segment(text), (s) => s.segment) : Array.from(text);
}

export function countText(text: string): TextCount {
  return { utf16: text.length, codePoints: cpLength(text), graphemes: graphemes(text).length };
}

// ---------------------------------------------------------------- tin chỉ có emoji

const EMOTICONS: Record<string, string> = { ':)': '🙂', ':(': '🙁', ':D': '😀', ';)': '😉', '<3': '❤️', ':P': '😛' };
const PICTO = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u;
/** Một grapheme có phải emoji không (gồm cờ, keycap 1️⃣). */
export const isEmojiGrapheme = (g: string) => PICTO.test(g);

/**
 * Tin chỉ gồm emoji, emoticon và khoảng trắng thì trả danh sách emoji (để hiện cỡ lớn),
 * ngược lại null. Emoticon được nhận ở BẤT KỲ vị trí nào (bản gốc chỉ nhận ở đầu tin).
 */
export function emojiOnly(text: string, maxEmoji = Infinity): string[] | null {
  const out: string[] = [];
  const tokens = text.split(/(\s+)/).filter(Boolean);
  for (const tok of tokens) {
    if (/^\s+$/.test(tok)) continue;
    let rest = tok;
    while (rest) {
      const emo = Object.keys(EMOTICONS).find((e) => rest.startsWith(e));
      if (emo) {
        out.push(EMOTICONS[emo]);
        rest = rest.slice(emo.length);
        continue;
      }
      const g = graphemes(rest)[0];
      if (!isEmojiGrapheme(g)) return null;
      out.push(g);
      rest = rest.slice(g.length);
    }
  }
  return out.length > 0 && out.length <= maxEmoji ? out : null;
}

/**
 * Ba tiện ích quanh "chữ người dùng gõ" (ý tưởng từ URLMatcher, ExpandableTextUtils,
 * MessengerMathUtils và HashtagSuggestionsStrategy của Facebook):
 *  - tìm URL trong đoạn văn, nuốt đúng cặp ngoặc nhưng bỏ dấu câu cuối câu
 *  - cắt chữ cho "Xem thêm" mà không chặt đôi một URL (hay một emoji)
 *  - chặn công thức LaTeX lồng quá sâu trước khi đưa cho trình render
 */

// ---- 1. Tìm URL ----

/** Điểm bắt đầu: có scheme, hoặc www. (www2., www3. cũng được). */
const START = /(?:\bhttps?:\/\/|\bwww\d{0,3}\.)[^\s<>"'`]+/giu;
/** Dấu câu thường đứng sau URL trong câu văn, không thuộc về URL. */
const TRAILING = /[.,;:!?'"»… -⁯]/u;

/**
 * Cắt phần đuôi của một ứng viên URL:
 *  - `(` mở một nhóm; chỉ "chốt" phần trong ngoặc khi gặp `)` đóng đúng cặp
 *  - `)` không có cặp (vd URL nằm trong ngoặc của câu văn) là điểm dừng
 *  - dấu câu ở cuối không được tính, trừ khi phía sau còn ký tự thường
 */
export function trimUrl(candidate: string): string {
  let end = 0;
  let depth = 0;
  for (let i = 0; i < candidate.length; i++) {
    const ch = candidate[i];
    if (ch === '(') {
      depth++;
      continue;
    }
    if (ch === ')') {
      if (depth === 0) break;
      depth--;
      if (depth === 0) end = i + 1;
      continue;
    }
    if (depth > 0) continue; // trong ngoặc: chờ tới khi đóng mới chốt
    if (TRAILING.test(ch)) continue; // dấu câu: chỉ được giữ nếu phía sau còn chữ
    end = i + 1;
  }
  return candidate.slice(0, end);
}

export interface UrlMatch {
  url: string;
  start: number;
  end: number;
}

export function findUrls(text: string): UrlMatch[] {
  const out: UrlMatch[] = [];
  for (const m of text.matchAll(START)) {
    const url = trimUrl(m[0]);
    if (url.length < 5) continue;
    out.push({ url, start: m.index!, end: m.index! + url.length });
  }
  return out;
}

/** Cách "ngây thơ" hay gặp: lấy hết tới khoảng trắng. */
export function findUrlsNaive(text: string): UrlMatch[] {
  return [...text.matchAll(/https?:\/\/\S+|www\.\S+/gi)].map((m) => ({
    url: m[0],
    start: m.index!,
    end: m.index! + m[0].length,
  }));
}

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

export function linkify(text: string, matches = findUrls(text)): Segment[] {
  const segments: Segment[] = [];
  let pos = 0;
  for (const m of matches) {
    if (m.start > pos) segments.push({ kind: 'text', text: text.slice(pos, m.start) });
    const href = /^https?:\/\//i.test(m.url) ? m.url : `https://${m.url}`;
    segments.push({ kind: 'link', text: m.url, href });
    pos = m.end;
  }
  if (pos < text.length) segments.push({ kind: 'text', text: text.slice(pos) });
  return segments;
}

// ---- 2. Cắt chữ không chặt URL ----

const graphemes =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** Lùi `index` về ranh giới grapheme gần nhất (không cắt giữa emoji hay chữ có dấu tổ hợp). */
function toGraphemeBoundary(text: string, index: number): number {
  if (!graphemes) {
    // không có Segmenter: ít nhất đừng cắt giữa cặp surrogate
    const code = text.charCodeAt(index - 1);
    return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
  }
  let last = 0;
  for (const { index: i } of graphemes.segment(text)) {
    if (i > index) break;
    last = i;
  }
  return last;
}

/**
 * Chỗ cắt an toàn cho đoạn "Xem thêm": nếu `limit` rơi vào giữa một URL thì lùi về
 * đầu URL đó (cả URL xuống dòng ẩn), rồi lùi tiếp về ranh giới grapheme.
 */
export function safeCutoff(text: string, limit: number): number {
  if (limit >= text.length) return text.length;
  let cut = limit;
  for (const m of findUrls(text)) {
    if (m.start >= cut) break;
    if (m.end > cut) {
      cut = m.start;
      break;
    }
  }
  return toGraphemeBoundary(text, cut);
}

// ---- 3. Giới hạn độ sâu LaTeX ----

/**
 * Độ lồng sâu nhất của `{…}` và `\begin…\end` (mỗi môi trường tính 2 bậc, như bản gốc).
 * Ký tự sau `\` được bỏ qua, nên `\{` không bị đếm.
 * Khác bản gốc: không để độ sâu âm. Bản gốc cho `}` thừa kéo bộ đếm xuống dưới 0,
 * khiến các `{` phía sau bị đếm thiếu.
 */
export function maxBraceDepth(tex: string): number {
  let depth = 0;
  let max = 0;
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === '\\') {
      if (tex.startsWith('\\begin', i)) {
        depth += 2;
        max = Math.max(max, depth);
      } else if (tex.startsWith('\\end', i)) {
        depth = Math.max(0, depth - 2);
      } else {
        i++; // bỏ qua ký tự được escape
      }
    } else if (ch === '{') {
      depth++;
      max = Math.max(max, depth);
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return max;
}

export interface LatexLimits {
  maxLength: number;
  maxDepth: number;
}

/** Giới hạn mặc định giống Messenger: dài tối đa 1000 ký tự, lồng tối đa 20. */
export const MESSENGER_LIMITS: LatexLimits = { maxLength: 1000, maxDepth: 20 };

export function checkLatex(tex: string, limits = MESSENGER_LIMITS): { ok: boolean; reason?: string; depth: number } {
  const depth = maxBraceDepth(tex);
  if (tex.length > limits.maxLength) return { ok: false, reason: 'quá dài', depth };
  if (depth > limits.maxDepth) return { ok: false, reason: 'lồng quá sâu', depth };
  return { ok: true, depth };
}

// ---- 4. Dấu # để mở gợi ý hashtag ----

/** `#` thường hoặc `＃` (U+FF03, bàn phím tiếng Nhật/Trung gõ ra). */
export function endsWithHashTrigger(text: string): boolean {
  return text.endsWith('#') || text.endsWith('＃');
}

/** Cách viết của bản gốc: chuỗi 6 ký tự "＃" chứ không phải ký tự U+FF03. */
export function endsWithHashTriggerFbStyle(text: string): boolean {
  return text.endsWith('#') || text.endsWith('\\uFF03');
}

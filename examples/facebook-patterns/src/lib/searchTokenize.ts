/**
 * Tìm kiếm "gõ không dấu vẫn ra" + tô đậm đúng đầu từ (ý tưởng từ TokenizeUtil và
 * cometSearchTypeaheadHighlightUtils của Facebook).
 *
 * Khác bản gốc:
 * - Gấp dấu bằng Unicode NFD thay cho bảng tra từng ký tự, nên đủ cả tiếng Việt
 *   ("Nguyễn" -> "nguyen", "Hưng" -> "hung"); bảng của Facebook thiếu ư, ơ, ă, ễ…
 * - Highlight tính trên chuỗi đã gấp rồi ánh xạ ngược về chuỗi gốc, nên gõ "nguyen"
 *   vẫn tô được "Nguyễn".
 * - Nhận diện chữ "nối nét" bằng Unicode Script, không dùng dải ký tự viết tay
 *   (bản gốc gõ nhầm dấu gạch dài "–" nên vài dải không còn là dải).
 */

// ---- 1. Gấp chữ: lowercase + bỏ dấu + phiên âm Cyrillic ----

/** Các chữ không tách được bằng NFD (không phải "chữ gốc + dấu"). */
const SPECIAL: Record<string, string> = {
  đ: 'd',
  ð: 'd',
  ł: 'l',
  ø: 'o',
  ħ: 'h',
  ı: 'i',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
};

/** Phiên âm Cyrillic cơ bản (kiểu hộ chiếu Nga), để "privet" tìm ra "Привет". */
const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia',
  і: 'i', ї: 'i', є: 'ie', ґ: 'g',
};

const COMBINING_MARKS = /\p{M}/gu;

/** Gấp MỘT ký tự (code point) thành chuỗi Latin thường, có thể rỗng hoặc dài hơn 1. */
export function foldChar(ch: string): string {
  const lower = ch.toLowerCase();
  if (lower in SPECIAL) return SPECIAL[lower];
  if (lower in CYRILLIC) return CYRILLIC[lower];
  // NFD tách "ễ" thành "e" + dấu mũ + dấu ngã; bỏ hết dấu (category M)
  return lower.normalize('NFD').replace(COMBINING_MARKS, '');
}

/**
 * Gấp cả chuỗi và giữ bảng ánh xạ: map[i] = vị trí (UTF-16) trong chuỗi gốc
 * của ký tự gấp thứ i. Cần cho highlight trên chuỗi gốc.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  let offset = 0;
  // for..of duyệt theo code point, không cắt đôi cặp surrogate (emoji, chữ Hán hiếm)
  for (const ch of text) {
    const f = foldChar(ch);
    for (let k = 0; k < f.length; k++) map.push(offset);
    folded += f;
    offset += ch.length;
  }
  map.push(offset); // vị trí "sau ký tự cuối", để cắt substring
  return { folded, map };
}

export const fold = (text: string) => foldWithMap(text).folded;

// ---- 2. Tách từ ----

/** Ranh giới từ: mọi thứ không phải chữ hoặc số (gồm cả dấu câu CJK, Ả Rập…). */
const SEPARATOR = /[^\p{L}\p{N}]+/u;

export function tokenize(folded: string): string[] {
  return folded.split(SEPARATOR).filter(Boolean);
}

export interface ParsedQuery {
  tokens: string[];
  /** từ cuối đang gõ dở -> so khớp kiểu tiền tố */
  lastIsPrefix: boolean;
}

// Cache kết quả parse: người dùng gõ "ng", "ngu", "nguy"… lặp lại cùng chuỗi rất nhiều.
// Facebook giới hạn 1000 mục và xoá SẠCH khi đầy; ở đây xoá mục cũ nhất (Map giữ thứ tự chèn).
const CACHE_LIMIT = 1000;
const parseCache = new Map<string, ParsedQuery>();

export function parseQuery(query: string): ParsedQuery {
  const hit = parseCache.get(query);
  if (hit) return hit;
  const folded = fold(query);
  const parsed = {
    tokens: tokenize(folded),
    // gõ "nguyen " (có dấu cách cuối) nghĩa là đã gõ xong từ đó
    lastIsPrefix: folded.length > 0 && !/\s$/u.test(folded),
  };
  if (parseCache.size >= CACHE_LIMIT) parseCache.delete(parseCache.keys().next().value!);
  parseCache.set(query, parsed);
  return parsed;
}

/**
 * Mọi từ của query phải khớp một từ KHÁC NHAU của target (không dùng lại một từ hai lần).
 * Từ cuối đang gõ dở thì chỉ cần là tiền tố; các từ trước phải là tiền tố hoặc khớp đủ
 * tuỳ `mode`.
 */
export function isQueryMatch(
  query: string,
  target: string,
  mode: 'query' | 'prefix' = 'query',
): boolean {
  const { tokens, lastIsPrefix } = parseQuery(query);
  if (tokens.length === 0) return false;
  const targetTokens = tokenize(fold(target));
  const used = new Set<number>();
  // từ dài trước: tránh từ ngắn "chiếm" mất từ đích mà từ dài cần (vd "an" và "anh")
  const order = tokens.map((t, i) => ({ t, i })).sort((a, b) => b.t.length - a.t.length);
  return order.every(({ t, i }) => {
    const prefixOk = mode === 'prefix' || (lastIsPrefix && i === tokens.length - 1);
    const index = targetTokens.findIndex(
      (tt, j) => !used.has(j) && (tt === t || (prefixOk && tt.startsWith(t))),
    );
    if (index === -1) return false;
    used.add(index);
    return true;
  });
}

// ---- 3. Highlight đầu từ ----

/**
 * Chữ viết có ghép nét: chèn <b> vào giữa sẽ phá hình chữ (ligature, dạng đầu/giữa/cuối
 * từ của chữ Ả Rập…), nên không highlight. Dùng Script property thay cho dải viết tay.
 */
const CONNECTED_SCRIPTS =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Thai}\p{Script=Lao}\p{Script=Tibetan}\p{Script=Myanmar}\p{Script=Khmer}\p{Script=Mongolian}]/u;

export const mayHaveConnectedCharacters = (text: string) => CONNECTED_SCRIPTS.test(text);

export interface Segment {
  text: string;
  matched: boolean;
}

/**
 * Tô đậm phần đầu những từ khớp với query, tính trên chuỗi đã gấp rồi cắt trên chuỗi gốc.
 * "nguyen" tô được "Nguyễn"; "an" tô được "(An)" vì đầu từ là sau bất kỳ ký tự không
 * phải chữ/số, không chỉ sau dấu cách.
 */
export function highlightMatch(query: string, text: string): Segment[] {
  const { tokens } = parseQuery(query);
  if (tokens.length === 0 || mayHaveConnectedCharacters(text)) return [{ text, matched: false }];

  const { folded, map } = foldWithMap(text);
  // các khoảng [start, end) trên chuỗi GẤP cần tô
  const ranges: Array<[number, number]> = [];
  const wordStart = /[\p{L}\p{N}]+/gu;
  for (let m = wordStart.exec(folded); m; m = wordStart.exec(folded)) {
    // lấy từ query dài nhất là tiền tố của từ này (gõ "ng nguy" thì tô "Nguy")
    let best = 0;
    for (const t of tokens) if (t.length > best && m[0].startsWith(t)) best = t.length;
    if (best > 0) ranges.push([m.index, m.index + best]);
  }
  if (ranges.length === 0) return [{ text, matched: false }];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    const from = map[start];
    // end là "sau ký tự gấp cuối": lấy vị trí gốc của ký tự gấp kế tiếp. Một ký tự gốc
    // có thể gấp ra nhiều ký tự ("щ" -> "shch"); khi đó tô trọn ký tự gốc.
    let to = map[end];
    if (end > start && map[end - 1] === map[end]) to = nextOriginalBoundary(map, end);
    if (from > cursor) segments.push({ text: text.slice(cursor, from), matched: false });
    segments.push({ text: text.slice(from, to), matched: true });
    cursor = to;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), matched: false });
  return segments;
}

function nextOriginalBoundary(map: number[], index: number) {
  const current = map[index];
  for (let i = index; i < map.length; i++) if (map[i] !== current) return map[i];
  return map[map.length - 1];
}

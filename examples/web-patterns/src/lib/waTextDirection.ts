/**
 * Xác định hướng chữ (ltr/rtl) theo ký tự mạnh đầu tiên, tra trong bảng khoảng code point nén delta.
 * Viết lại từ ý tưởng của WhatsApp Web 2020 (module dehfadfiij: dir(), dadiabfgjj: bảng JSON).
 */

export type Dir = 'ltr' | 'rtl';

/**
 * Bảng nén: dãy cặp [khoảng cách từ đầu khoảng trước, độ dài có dấu].
 * Độ dài dương = chữ mạnh trái-sang-phải, âm = phải-sang-trái. Ví dụ [65, 26, 32, 26] = A–Z, a–z.
 */
export type PackedTable = readonly number[];

export interface Range {
  start: number;
  length: number;
  dir: Dir;
}

/** Danh sách khoảng (đã sắp xếp, không chồng nhau) → dãy số nén. */
export function packRanges(ranges: Range[]): number[] {
  const out: number[] = [];
  let prev = 0;
  for (const r of ranges) {
    out.push(r.start - prev, r.dir === 'rtl' ? -r.length : r.length);
    prev = r.start;
  }
  return out;
}

/** Gom các code point liên tiếp cùng hướng thành khoảng. `classify` trả null cho ký tự trung tính. */
export function buildRanges(classify: (cp: number) => Dir | null, maxCodePoint = 0x10ffff): Range[] {
  const ranges: Range[] = [];
  let cur: Range | null = null;
  for (let cp = 0; cp <= maxCodePoint; cp++) {
    if (cp === 0xd800) cp = 0xe000; // bỏ vùng surrogate
    const d = classify(cp);
    if (d && cur && cur.dir === d && cur.start + cur.length === cp) cur.length++;
    else if (d) ranges.push((cur = { start: cp, length: 1, dir: d }));
    else cur = null;
  }
  return ranges;
}

/** Hướng của chữ cái theo script. JS regex không có Bidi_Class nên đây là bản xấp xỉ (R/AL ≈ chữ thuộc script viết phải-sang-trái). */
const RTL_SCRIPT_NAMES = [
  'Hebrew', 'Arabic', 'Syriac', 'Thaana', 'Nko', 'Samaritan', 'Mandaic', 'Adlam', 'Hanifi_Rohingya',
  'Mende_Kikakui', 'Imperial_Aramaic', 'Phoenician', 'Kharoshthi', 'Old_South_Arabian', 'Old_North_Arabian',
  'Avestan', 'Inscriptional_Parthian', 'Inscriptional_Pahlavi', 'Psalter_Pahlavi', 'Manichaean', 'Nabataean',
  'Palmyrene', 'Hatran', 'Old_Hungarian', 'Sogdian', 'Old_Sogdian', 'Yezidi', 'Elymaic', 'Chorasmian', 'Lydian',
  'Cypriot', 'Meroitic_Cursive', 'Meroitic_Hieroglyphs', 'Old_Turkic', 'Old_Uyghur', 'Garay',
];
let rtlScripts: RegExp | undefined;
/** Tạo lười: script mới (vd Old_Uyghur, Unicode 14) làm regex literal lỗi cú pháp trên engine cũ. */
function rtlRegex(): RegExp {
  if (rtlScripts) return rtlScripts;
  const known = RTL_SCRIPT_NAMES.filter((n) => {
    try {
      new RegExp(`\\p{sc=${n}}`, 'u');
      return true;
    } catch {
      return false;
    }
  });
  return (rtlScripts = new RegExp(`[${known.map((n) => `\\p{sc=${n}}`).join('')}]`, 'u'));
}

const STRONG = /[\p{L}\p{Mc}\p{Nl}]/u;
/** Trong script phải-sang-trái, dấu câu (־ ۔) cũng là ký tự mạnh; dấu phụ, ngoặc thì không. */
const RTL_WEAK = /[\p{Mn}\p{Me}\p{Cf}\p{Z}\p{Cc}\p{Ps}\p{Pe}]/u;
/** Chữ số Ả Rập là "số Ả Rập" (AN, yếu); chữ số N'Ko, Adlam… là R (mạnh). */
const isArabicDigit = (cp: number) =>
  (cp >= 0x0660 && cp <= 0x0669) || (cp >= 0x06f0 && cp <= 0x06f9) || (cp >= 0x10d30 && cp <= 0x10d39) || (cp >= 0x10e60 && cp <= 0x10e7e);
const RTL_WEAK_CPS = new Set([0x0609, 0x060a, 0x060c, 0x066a, 0x066b, 0x066c, 0x06dd, 0x0890, 0x0891, 0x08e2]);
/** Ký tự thuộc script Common nhưng Bidi_Class = AL: ؛ ؟ và ـ (tatweel). */
const RTL_COMMON = new Set([0x061b, 0x061f, 0x0640]);
const PRIVATE_USE = /\p{Co}/u;
const UNASSIGNED = /\p{Cn}/u;
/** Khối mà Unicode quy định ký tự chưa gán mặc định là R/AL (DerivedBidiClass.txt). */
const RTL_DEFAULT_BLOCKS: [number, number][] = [
  [0x0590, 0x08ff], [0xfb1d, 0xfdcf], [0xfdf0, 0xfdff], [0xfe70, 0xfeff], [0x10800, 0x10fff], [0x1e800, 0x1efff],
];

export function classifyByScript(cp: number): Dir | null {
  if (cp === 0x200e) return 'ltr'; // LRM
  if (cp === 0x200f || cp === 0x061c) return 'rtl'; // RLM, ALM
  const ch = String.fromCodePoint(cp);
  if (PRIVATE_USE.test(ch)) return 'ltr'; // vùng dùng riêng có Bidi_Class = L
  if (UNASSIGNED.test(ch)) {
    if ((cp & 0xfffe) === 0xfffe || (cp >= 0xfdd0 && cp <= 0xfdef)) return null; // noncharacter
    return RTL_DEFAULT_BLOCKS.some(([a, b]) => cp >= a && cp <= b) ? 'rtl' : null;
  }
  if (RTL_COMMON.has(cp)) return 'rtl';
  if (rtlRegex().test(ch)) return RTL_WEAK.test(ch) || RTL_WEAK_CPS.has(cp) || isArabicDigit(cp) ? null : 'rtl';
  return STRONG.test(ch) ? 'ltr' : null;
}

/** Bảng đã giải nén: mảng đầu khoảng và độ dài có dấu, tra bằng tìm kiếm nhị phân. */
export class DirectionTable {
  private starts?: Int32Array;
  private lengths?: Int32Array;

  constructor(private readonly packed: PackedTable) {}

  get rangeCount(): number {
    return this.packed.length / 2;
  }

  /** Giải nén lần đầu dùng (bản gốc cũng lười như vậy): cộng dồn khoảng cách thành vị trí tuyệt đối. */
  private decode() {
    const n = this.packed.length / 2;
    const starts = new Int32Array(n);
    const lengths = new Int32Array(n);
    let pos = 0;
    for (let k = 0; k < n; k++) {
      pos += this.packed[2 * k];
      starts[k] = pos;
      lengths[k] = this.packed[2 * k + 1];
    }
    this.starts = starts;
    this.lengths = lengths;
  }

  lookup(cp: number): Dir | null {
    if (!this.starts) this.decode();
    const starts = this.starts!;
    let lo = 0;
    let hi = starts.length - 1;
    if (hi < 0 || cp < starts[0]) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1; // khoảng cuối cùng có start ≤ cp
      if (starts[mid] <= cp) lo = mid;
      else hi = mid - 1;
    }
    const len = this.lengths![lo];
    return cp < starts[lo] + Math.abs(len) ? (len < 0 ? 'rtl' : 'ltr') : null;
  }
}

export interface DirOptions {
  /** Bỏ qua phần nằm giữa LRI/RLI/FSI … PDI như thuật toán bidi (bản gốc không làm). */
  skipIsolates?: boolean;
}

/** Hướng của ký tự mạnh đầu tiên; undefined nếu chuỗi chỉ có số, dấu câu, emoji… */
export function detectDir(text: string, table: DirectionTable, { skipIsolates = true }: DirOptions = {}): Dir | undefined {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++; // cặp surrogate hợp lệ; surrogate lẻ tự rơi vào vùng trung tính
    if (skipIsolates) {
      if (cp >= 0x2066 && cp <= 0x2068) depth++;
      else if (cp === 0x2069 && depth > 0) depth--;
      if (depth > 0 || cp === 0x2069) continue;
    }
    const d = table.lookup(cp);
    if (d) return d;
  }
  return undefined;
}

/**
 * Ba việc nhỏ quanh "số và chữ" mà client Facebook tự làm:
 * 1. Số nguyên 64-bit (ID, timestamp micro giây) không mất chính xác: Facebook mang theo bản port
 *    của goog.math.Long (hai nửa 32-bit). Ở đây dùng BigInt, chỉ giữ phần chuyển đổi hi/lo.
 * 2. Decode UTF-8 từ bytes: Facebook tự viết StringEncoding. Bản này làm đúng thuật toán
 *    WHATWG (giống TextDecoder) và thêm các chính sách xử lý ký tự NUL.
 * 3. Đổi offset tính theo code point (server gửi) sang offset UTF-16 (JavaScript dùng),
 *    ý tưởng từ decodeEntityRanges.
 */

// ---------------- 1. Int64 ----------------

const MIN = -(1n << 63n);
const MAX = (1n << 63n) - 1n;

/** Parse chặt: sai định dạng hay tràn 64-bit thì ném lỗi, không âm thầm quấn vòng. */
export function parseInt64(text: string): bigint {
  if (!/^-?\d+$/.test(text)) throw new SyntaxError(`Không phải số nguyên: "${text}"`);
  const n = BigInt(text);
  if (n < MIN || n > MAX) throw new RangeError(`Tràn int64: ${text}`);
  return n;
}

/** Tách thành hai nửa 32-bit có dấu, đúng như low_/high_ của Long. */
export function toHiLo(n: bigint): { high: number; low: number } {
  const u = BigInt.asUintN(64, n);
  return { high: Number(BigInt.asIntN(32, u >> 32n)), low: Number(BigInt.asIntN(32, u)) };
}

export function fromHiLo(high: number, low: number): bigint {
  return BigInt.asIntN(64, (BigInt(high) << 32n) | BigInt(low >>> 0));
}

/** ID dạng chuỗi có đi qua Number an toàn không? (2^53 trở lên thì không chắc) */
export function survivesNumber(text: string): boolean {
  return String(Number(text)) === text;
}

/** JSON.parse giữ số lớn ở dạng chuỗi: bọc các số nguyên dài >= 16 chữ số trong ngoặc kép. */
export function parseJsonKeepBigInts(json: string): unknown {
  return JSON.parse(json.replace(/("(?:[^"\\]|\\.)*")|(?<![\d.eE+-])(-?\d{16,})(?=\s*[,}\]])/g, (m, str, num) => (str ? m : `"${num}"`)));
}

// ---------------- 2. UTF-8 ----------------

export type NullPolicy = 'error' | 'ignore' | 'truncate' | 'include';

export interface Utf8Options {
  /** true: gặp byte sai thì ném lỗi; false: thay bằng U+FFFD như TextDecoder */
  fatal?: boolean;
  nulls?: NullPolicy;
}

/**
 * Decoder UTF-8 theo đặc tả WHATWG Encoding. Chặn được: dạng overlong (C0 AF), surrogate
 * mã hoá trong UTF-8 (ED A0 80), code point > U+10FFFF, dạng 5-6 byte, chuỗi cụt.
 */
export function decodeUtf8(bytes: Uint8Array, { fatal = false, nulls = 'include' }: Utf8Options = {}): string {
  const out: string[] = [];
  let chunk: number[] = [];
  const emit = (cp: number) => {
    chunk.push(cp);
    // String.fromCodePoint(...arr) với mảng rất lớn sẽ tràn stack, nên đẩy theo từng khúc
    if (chunk.length === 8192) {
      out.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
  };
  const bad = (i: number) => {
    if (fatal) throw new TypeError(`UTF-8 không hợp lệ tại byte ${i}`);
    emit(0xfffd);
  };

  let needed = 0;
  let seen = 0;
  let cp = 0;
  let lower = 0x80;
  let upper = 0xbf;

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (needed === 0) {
      if (b <= 0x7f) {
        if (b === 0) {
          if (nulls === 'error') throw new TypeError(`Có ký tự NUL tại byte ${i}`);
          if (nulls === 'truncate') break;
          if (nulls === 'ignore') continue; // vòng for vẫn tăng i, không kẹt như bản gốc
        }
        emit(b);
      } else if (b >= 0xc2 && b <= 0xdf) {
        needed = 1;
        cp = b & 0x1f;
      } else if (b >= 0xe0 && b <= 0xef) {
        if (b === 0xe0) lower = 0xa0; // chặn overlong 3 byte
        if (b === 0xed) upper = 0x9f; // chặn surrogate D800–DFFF
        needed = 2;
        cp = b & 0x0f;
      } else if (b >= 0xf0 && b <= 0xf4) {
        if (b === 0xf0) lower = 0x90; // chặn overlong 4 byte
        if (b === 0xf4) upper = 0x8f; // chặn > U+10FFFF
        needed = 3;
        cp = b & 0x07;
      } else {
        bad(i); // 80–C1, F5–FF: không bao giờ là byte đầu hợp lệ
      }
      continue;
    }
    if (b < lower || b > upper) {
      // chuỗi đang dở bị cắt: báo lỗi một lần rồi xử lý lại byte này như byte đầu
      needed = seen = cp = 0;
      lower = 0x80;
      upper = 0xbf;
      bad(i);
      i--;
      continue;
    }
    lower = 0x80;
    upper = 0xbf;
    cp = (cp << 6) | (b & 0x3f);
    if (++seen === needed) {
      emit(cp);
      needed = seen = cp = 0;
    }
  }
  if (needed) bad(bytes.length);
  out.push(String.fromCodePoint(...chunk));
  return out.join('');
}

// ---------------- 3. Offset code point ↔ UTF-16 ----------------

export interface CodePointRange<K = string> {
  offset: number; // tính theo code point
  length: number;
  key: K;
}

/**
 * Đổi một lượt cho nhiều range: duyệt chuỗi một lần, O(độ dài + số range).
 * Bản gốc gọi substr theo code point cho từng range, mỗi lần duyệt lại từ đầu chuỗi.
 */
export function toUtf16Ranges<K>(text: string, ranges: CodePointRange<K>[]) {
  const marks = new Set<number>();
  for (const r of ranges) marks.add(r.offset).add(r.offset + r.length);
  const at = new Map<number, number>();
  let cpIndex = 0;
  let u16 = 0;
  for (const ch of text) {
    if (marks.has(cpIndex)) at.set(cpIndex, u16);
    cpIndex++;
    u16 += ch.length; // 2 với emoji/ký tự ngoài BMP
  }
  at.set(cpIndex, u16); // cho range kết thúc đúng cuối chuỗi
  const clamp = (cp: number) => at.get(Math.min(cp, cpIndex)) ?? u16;
  return ranges.map((r) => ({ key: r.key, start: clamp(r.offset), end: clamp(r.offset + r.length) }));
}

/** Ngược lại: offset UTF-16 (ví dụ từ selectionStart) sang offset code point để gửi lên server. */
export function utf16ToCodePoint(text: string, u16Offset: number): number {
  let cp = 0;
  for (let i = 0; i < u16Offset && i < text.length; cp++) {
    const c = text.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff ? 2 : 1;
  }
  return cp;
}

/** Cắt chuỗi thành các đoạn để render (đậm, link…), range chồng nhau thì range sau bị bỏ. */
export function segment<K>(text: string, ranges: CodePointRange<K>[]) {
  const spans = toUtf16Ranges(text, ranges).sort((a, b) => a.start - b.start);
  const parts: { text: string; key: K | null }[] = [];
  let pos = 0;
  for (const s of spans) {
    if (s.start < pos) continue;
    if (s.start > pos) parts.push({ text: text.slice(pos, s.start), key: null });
    parts.push({ text: text.slice(s.start, s.end), key: s.key });
    pos = s.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos), key: null });
  return parts;
}

/**
 * Đọc giá tiền người dùng gõ theo locale, trả về số nguyên "phần nghìn" (amount1000) —
 * viết lại từ ý tưởng của WhatsApp Web 2020 (module bjgiedaj, bảng dgbiieecah). Không phải mã gốc.
 */

export interface NumberSymbols {
  locale: string;
  group: string;
  decimal: string;
  /** chữ số của locale theo thứ tự 0–9 (Ả Rập: ٠١٢…) */
  digits: string[];
  /** ký hiệu tiền tệ như locale viết: "₫", "€", "Rp", "US$"… */
  currency: string;
  /** số chữ số thập phân của đơn vị tiền */
  fractionDigits: number;
}

/** Lấy ký hiệu từ formatToParts — không cắt chuỗi theo vị trí. */
export function numberSymbols(locale: string, currency: string): NumberSymbols {
  const nf = new Intl.NumberFormat(locale, { style: 'currency', currency });
  const parts = nf.formatToParts(1234567.5);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const plain = new Intl.NumberFormat(locale, { useGrouping: false });
  return {
    locale: nf.resolvedOptions().locale,
    group: pick('group'),
    decimal: pick('decimal') || plain.formatToParts(1.5).find((p) => p.type === 'decimal')?.value || '.',
    digits: Array.from({ length: 10 }, (_, d) => plain.format(d)),
    currency: pick('currency'),
    fractionDigits: nf.resolvedOptions().maximumFractionDigits ?? 2,
  };
}

/** Các khoảng trắng mà locale dùng làm dấu nhóm (fr: U+202F, ru: U+00A0), người dùng thì gõ dấu cách thường. */
const SPACES = /[\s\u00a0\u202f\u2009]/;
/** Giới hạn của bản gốc: 2^52 phần nghìn. */
export const MAX_AMOUNT1000 = 2 ** 52;

export type ParseResult =
  | { ok: true; amount1000: number }
  | { ok: false; reason: 'empty' | 'chars' | 'group' | 'decimals' | 'range' };

export function parsePrice(input: string, sym: NumberSymbols): ParseResult {
  // 1. chữ số địa phương → ASCII, bỏ ký hiệu/mã tiền tệ
  let s = input.normalize('NFKC');
  sym.digits.forEach((d, i) => (s = s.split(d).join(String(i))));
  if (sym.currency) s = s.split(sym.currency.normalize('NFKC')).join('');
  s = s.replace(/\p{Sc}|[A-Z]{3}|[\u200e\u200f\u061c]/gu, '').trim();
  if (!s) return { ok: false, reason: 'empty' };

  // 2. tách phần nguyên / phần thập phân theo dấu thập phân của locale
  const isSpaceGroup = SPACES.test(sym.group || ' ');
  const [intRaw, frac = '', ...rest] = s.split(sym.decimal);
  if (rest.length) return { ok: false, reason: 'chars' };
  const groups = isSpaceGroup ? intRaw.split(SPACES) : intRaw.split(sym.group || '\u0000');
  if (!groups.every((g) => /^\d+$/.test(g)) || !/^\d*$/.test(frac)) return { ok: false, reason: 'chars' };

  // 3. có dấu nhóm thì phải đúng chỗ: nhóm cuối 3 chữ số, nhóm giữa 2–3 (en-IN: 1,00,000)
  if (groups.length > 1) {
    const [first, ...others] = groups;
    const last = others.pop()!;
    if (first.length > 3 || last.length !== 3 || others.some((g) => g.length < 2 || g.length > 3)) {
      return { ok: false, reason: 'group' };
    }
  }
  if (frac.length > Math.min(sym.fractionDigits, 3)) return { ok: false, reason: 'decimals' };

  // 4. ghép chuỗi chữ số rồi mới đổi sang số: không qua parseFloat, không sai số dấu phẩy động
  const amount1000 = Number(groups.join('') + frac.padEnd(3, '0'));
  if (!(amount1000 >= 1 && amount1000 <= MAX_AMOUNT1000)) return { ok: false, reason: 'range' };
  return { ok: true, amount1000 };
}

export function formatPrice(amount1000: number, locale: string, currency: string) {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount1000 / 1000);
}

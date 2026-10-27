/**
 * Nhận diện hãng thẻ + kiểm số thẻ (ý tưởng từ PaymentMethodUtils của Facebook).
 *
 * - Chuẩn hoá "kiểu OCR": i/I/l thành 1, O/o thành 0, rồi bỏ mọi ký tự không phải số.
 * - Dò hãng theo THỨ TỰ: dải BIN 6 số của Elo (trùng tiền tố Visa 4…, phải dò trước),
 *   tiền tố 65 tách RuPay (652150–653143) khỏi Discover, rồi tới bảng regex.
 * - Luhn: nhân đôi chữ số ở vị trí lẻ (đếm từ phải), cộng mọi chữ số của kết quả.
 *
 * Khác bản gốc: dò hãng trên chuỗi ĐÃ chuẩn hoá (bản gốc chạy regex trên chuỗi người dùng gõ,
 * " 4111…" ra unknown), và mỗi hãng có danh sách độ dài hợp lệ (Visa 13/16/19, UnionPay 16–19…)
 * thay vì cố định 16.
 */

export type CardBrand =
  | 'elo'
  | 'mastercard'
  | 'visa'
  | 'amex'
  | 'jcb'
  | 'unionpay'
  | 'discover'
  | 'rupay'
  | 'diners'
  | 'unknown';

export interface CardType {
  brand: CardBrand;
  label: string;
  /** độ dài hợp lệ */
  lengths: number[];
  cscDigits: number;
  /** vị trí cắt nhóm khi hiển thị */
  groups: number[];
  supported: boolean;
}

const G4 = [4, 8, 12, 16, 19];

const TYPES: Record<CardBrand, CardType> = {
  elo: { brand: 'elo', label: 'Elo', lengths: [16], cscDigits: 3, groups: G4, supported: true },
  mastercard: {
    brand: 'mastercard',
    label: 'Mastercard',
    lengths: [16],
    cscDigits: 3,
    groups: G4,
    supported: true,
  },
  visa: {
    brand: 'visa',
    label: 'Visa',
    lengths: [13, 16, 19],
    cscDigits: 3,
    groups: G4,
    supported: true,
  },
  amex: {
    brand: 'amex',
    label: 'American Express',
    lengths: [15],
    cscDigits: 4,
    groups: [4, 10, 15],
    supported: true,
  },
  jcb: {
    brand: 'jcb',
    label: 'JCB',
    lengths: [16, 17, 18, 19],
    cscDigits: 3,
    groups: G4,
    supported: true,
  },
  unionpay: {
    brand: 'unionpay',
    label: 'UnionPay',
    lengths: [16, 17, 18, 19],
    cscDigits: 3,
    groups: G4,
    supported: true,
  },
  discover: {
    brand: 'discover',
    label: 'Discover',
    lengths: [16, 19],
    cscDigits: 3,
    groups: G4,
    supported: true,
  },
  rupay: {
    brand: 'rupay',
    label: 'RuPay',
    lengths: [16],
    cscDigits: 3,
    groups: G4,
    supported: true,
  },
  diners: {
    brand: 'diners',
    label: 'Diners Club',
    lengths: [14],
    cscDigits: 3,
    groups: [4, 10, 14],
    supported: false,
  },
  unknown: {
    brand: 'unknown',
    label: 'Thẻ',
    lengths: [16],
    cscDigits: 3,
    groups: G4,
    supported: false,
  },
};

/** Dải BIN 6 số của Elo (lấy từ bảng của Facebook, rút gọn còn các dải đầu). */
const ELO_RANGES: Array<[number, number]> = [
  [401178, 401179],
  [431274, 431274],
  [438935, 438935],
  [457393, 457393],
  [457631, 457632],
  [504175, 504175],
  [506717, 506718],
  [506720, 506721],
  [506723, 506733],
  [509000, 509002],
  [509107, 509807],
  [636297, 636297],
  [636368, 636368],
  [650485, 650513],
  [651652, 651704],
  [655000, 655019],
  [655021, 655058],
];

const PATTERNS: Array<[CardBrand, RegExp]> = [
  // 51–55 và dải mới 2221–2720
  ['mastercard', /^(5[1-5]|2(2(2[1-9]|[3-9])|[3-6]|7([01]|20)))/],
  ['visa', /^4/],
  ['amex', /^3[47]/],
  ['jcb', /^35(2[89]|[3-8])/],
  ['unionpay', /^62/],
  ['discover', /^(6011|65|64[4-9])/],
  ['rupay', /^(508[5-9]|60[6-8])/],
  ['diners', /^30[0-5]|^3[689]/],
];

/** i/I/l → 1, O/o → 0 (lỗi OCR hay gặp), rồi chỉ giữ chữ số. */
export function normalizeCardNumber(input: string) {
  return input.replace(/[iIl]/g, '1').replace(/[Oo]/g, '0').replace(/\D/g, '');
}

function inRanges(bin6: number, ranges: Array<[number, number]>) {
  return ranges.some(([lo, hi]) => bin6 >= lo && bin6 <= hi);
}

export function detectCardType(input: string): CardType {
  const digits = normalizeCardNumber(input);
  if (digits.length >= 6) {
    const bin6 = Number(digits.slice(0, 6));
    if (inRanges(bin6, ELO_RANGES)) return TYPES.elo;
    if (digits.startsWith('65'))
      return bin6 >= 652150 && bin6 <= 653143 ? TYPES.rupay : TYPES.discover;
  }
  for (const [brand, pattern] of PATTERNS) {
    if (pattern.test(digits)) return TYPES[brand];
  }
  return TYPES.unknown;
}

/** Kiểm Luhn. Chuỗi rỗng / toàn số 0 bị coi là sai. */
export function luhnValid(input: string) {
  const digits = normalizeCardNumber(input);
  if (digits.length === 0) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = digits.charCodeAt(digits.length - 1 - i) - 48;
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9; // = cộng hai chữ số của d
    }
    sum += d;
  }
  return sum !== 0 && sum % 10 === 0;
}

export type CardCheck =
  | { ok: true; type: CardType }
  | { ok: false; type: CardType; reason: 'unsupported' | 'length' | 'checksum' | 'incomplete' };

export function validateCardNumber(input: string): CardCheck {
  const digits = normalizeCardNumber(input);
  const type = detectCardType(digits);
  const max = Math.max(...type.lengths);
  if (digits.length < Math.min(...type.lengths)) return { ok: false, type, reason: 'incomplete' };
  if (!type.supported) return { ok: false, type, reason: 'unsupported' };
  if (!type.lengths.includes(digits.length)) {
    return { ok: false, type, reason: digits.length > max ? 'length' : 'incomplete' };
  }
  if (!luhnValid(digits)) return { ok: false, type, reason: 'checksum' };
  return { ok: true, type };
}

/** Chèn khoảng trắng theo nhóm của hãng: Amex 4-6-5, còn lại 4-4-4-4(-3). */
export function formatCardNumber(input: string) {
  const digits = normalizeCardNumber(input);
  const type = detectCardType(digits);
  const max = Math.max(...type.lengths);
  const clipped = digits.slice(0, max);
  const parts: string[] = [];
  let from = 0;
  for (const to of type.groups) {
    if (from >= clipped.length) break;
    parts.push(clipped.slice(from, to));
    from = to;
  }
  if (from < clipped.length) parts.push(clipped.slice(from));
  return parts.join(' ');
}

/**
 * Giữ con trỏ đúng chỗ sau khi format lại: đếm số chữ số đứng trước con trỏ trong chuỗi cũ,
 * rồi tìm vị trí có đúng chừng ấy chữ số trong chuỗi mới.
 */
export function caretAfterFormat(raw: string, caret: number, formatted: string) {
  const digitsBefore = normalizeCardNumber(raw.slice(0, caret)).length;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (seen === digitsBefore) return i;
    if (/\d/.test(formatted[i])) seen++;
  }
  return formatted.length;
}

// ---------------------------------------------------------------------------
// Mô phỏng hành vi bản gốc (để so sánh trong demo và bài viết, không phải code của Facebook)
// ---------------------------------------------------------------------------

const ORIGINAL_PATTERNS: Array<[CardBrand, RegExp]> = [['elo', /^40117[89]/], ...PATTERNS];

/** Bản gốc: Elo/RuPay dò trên chuỗi đã chuẩn hoá, nhưng bảng regex lại chạy trên CHUỖI GỐC. */
export function detectCardTypeLikeOriginal(input: string): CardType {
  const digits = normalizeCardNumber(input);
  const bin6 = digits.slice(0, 6);
  if (inRanges(Number(bin6), ELO_RANGES)) return TYPES.elo;
  if (bin6.startsWith('65'))
    return Number(bin6) >= 652150 && Number(bin6) <= 653143 ? TYPES.rupay : TYPES.discover;
  for (const [brand, pattern] of ORIGINAL_PATTERNS) if (input.match(pattern)) return TYPES[brand];
  return TYPES.unknown;
}

/** Bản gốc: mọi hãng (trừ Amex/Diners) chỉ nhận đúng 16 số. */
export function validateLikeOriginal(input: string) {
  const digits = normalizeCardNumber(input);
  const type = detectCardTypeLikeOriginal(digits);
  const expected = type.brand === 'amex' ? 15 : type.brand === 'diners' ? 14 : 16;
  return type.supported && digits.length === expected && luhnValid(digits);
}

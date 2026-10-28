/**
 * Định dạng số, kiểm tra dữ liệu nhập theo locale: bản sửa của sáu bug đọc được trong
 * JobsCometComposerSalaryHelpers, CommerceInvoiceAdminUtil, adsRegulatedCategoryIsInvalidGeoLocations,
 * CometFormDateUtils, VideoCaptionValidator và ShopUtils (Facebook). Viết lại từ đầu.
 * Các hàm tiền tố `fb` mô phỏng hành vi bản gốc để so sánh.
 */

// ---------- 1. Số tiền ----------

/** Dấu thập phân và dấu nhóm nghìn của locale, lấy từ chính Intl. */
export function separators(locale: string) {
  const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
  return {
    group: parts.find((p) => p.type === 'group')?.value ?? '',
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
  };
}

/** Số chữ số lẻ chuẩn của đồng tiền (VND 0, USD 2, KWD 3). */
export const currencyDigits = (currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;

/**
 * Định dạng tiền, bỏ phần lẻ khi nó toàn số 0 ("25 US$" chứ không "25,00 US$").
 * Không đụng vào chuỗi đã định dạng: quyết định số chữ số lẻ trước khi gọi Intl.
 */
export function formatMoney(amount: number, currency: string, locale: string) {
  const digits = currencyDigits(currency);
  const isWhole = Math.abs(amount - Math.round(amount)) < 10 ** -(digits + 1);
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: isWhole ? 0 : digits,
    maximumFractionDigits: digits,
  }).format(amount);
}

/** Mẫu hiển thị và số chữ số lẻ theo bảng cấu hình tiền tệ của bản gốc (offset 1 → 0 chữ số, 100 → 2). */
export const FB_CURRENCY: Record<string, { format: string; symbol: string; digits: number }> = {
  VND: { format: '{amount} {symbol}', symbol: '₫', digits: 0 },
  USD: { format: '{symbol}{amount}', symbol: '$', digits: 2 },
  EUR: { format: '{symbol} {amount}', symbol: '€', digits: 2 },
  JPY: { format: '{symbol}{amount}', symbol: '¥', digits: 0 },
};

/** Cách của bản gốc: số theo dấu của locale, ghép ký hiệu, rồi xoá chuỗi ".00" đầu tiên tìm thấy. */
export function fbFormatSalary(amount: number, currency: string, locale: string) {
  const cfg = FB_CURRENCY[currency] ?? { format: '{amount} {symbol}', symbol: currency, digits: 2 };
  const n = new Intl.NumberFormat(locale, { minimumFractionDigits: cfg.digits, maximumFractionDigits: cfg.digits }).format(amount);
  return cfg.format.replace('{symbol}', cfg.symbol).replace('{amount}', n).replace('.00', '');
}

/** Chèn dấu nhóm nghìn vào chuỗi người dùng gõ (giữ nguyên phần lẻ đã gõ). */
export function groupDigits(raw: string, locale = 'en-US') {
  const { group, decimal } = separators(locale);
  const m = /^\s*([-+]?)(\d*)(?:\.(\d*))?\s*$/.exec(raw);
  if (!m) return raw; // không phải số: trả nguyên, để validator báo
  const [, sign, int, frac] = m;
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, group); // chỉ phần nguyên
  return sign + grouped + (frac !== undefined ? decimal + frac : '');
}

/** Đọc lại số đã định dạng theo locale. null nếu không hợp lệ. */
export function parseLocaleNumber(text: string, locale = 'en-US'): number | null {
  const { group, decimal } = separators(locale);
  let s = text.trim();
  // nhóm nghìn có thể là NBSP / narrow NBSP (fr-FR), xoá tất cả, không chỉ cái đầu
  for (const g of new Set([group, ' ', ' ', ' '])) if (g && g !== decimal) s = s.split(g).join('');
  if (decimal !== '.') {
    if (s.includes('.')) return null; // "1.5" trong locale dùng dấu phẩy: mơ hồ, từ chối
    s = s.replace(decimal, '.');
  }
  return /^[-+]?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** CommerceInvoiceAdminUtil.formatDollars: duyệt từ phải, cứ 3 ký tự chèn "," (đếm cả phần lẻ). */
export function fbFormatDollars(a: string) {
  const out: string[] = [];
  let count = 0;
  for (let i = a.length - 1; i >= 0; i--) {
    out.unshift(a[i]);
    count++;
    if (a[i] === '.') count = 0;
    else if (count === 3 && i !== 0) {
      out.unshift(',');
      count = 0;
    }
  }
  return out.join('');
}

/** unformatDollars: replace với chuỗi chỉ thay lần xuất hiện đầu. */
export const fbUnformatDollars = (a: string) => a.replace(',', '');

// ---------- 2. Điều kiện ----------

export type DistanceUnit = 'mile' | 'kilometer';
export const MIN_RADIUS: Record<DistanceUnit, number> = { mile: 15, kilometer: 25 };

/** Đúng: mỗi đơn vị một ngưỡng. */
export const radiusAllowed = (unit: DistanceUnit, radius: number) => radius >= MIN_RADIUS[unit];

/** Bản gốc: `unit === km && r >= 25 || r >= 15`, && ưu tiên hơn || nên km chỉ cần ≥ 15. */
export const fbRadiusAllowed = (unit: DistanceUnit, radius: number) =>
  (unit === 'kilometer' && radius >= MIN_RADIUS.kilometer) || radius >= MIN_RADIUS.mile;

/** Ghép ngày (Date) với giờ (giây từ 0h) bằng các thành phần số, không qua chuỗi. */
export function combineDateAndTime(date: Date, secondsOfDay: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, secondsOfDay);
}

/** Bản gốc: "M/D/" + getYear() (năm − 1900) rồi new Date(chuỗi). */
export function fbCombineDateAndTime(date: Date, secondsOfDay: number) {
  // getYear() đã bị loại khỏi chuẩn nhưng trình duyệt vẫn giữ (Annex B)
  const year = (date as Date & { getYear(): number }).getYear();
  const h = Math.floor(secondsOfDay / 3600), m = Math.floor((secondsOfDay / 60) % 60), s = secondsOfDay % 60;
  return new Date(`${date.getMonth() + 1}/${date.getDate()}/${year} ${h}:${m}:${s}`);
}

// ---------- 3. Văn bản: phụ đề SRT, hộp thư bưu điện ----------

export const SRT_ERR = { BAD_INDEX: 2415001, WRONG_SEQUENCE: 2415002, BAD_TIMING_LINE: 2415003, END_BEFORE_START: 2415004 } as const;

export interface SrtCue {
  index: number;
  start: number;
  end: number;
  text: string;
}

export interface SrtProblem {
  code: number;
  line: number;
  message: string;
}

const TIME = /^(\d{1,2}):(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/;

/** "01:02:03,5" → ms. Phần lẻ là phần thập phân của giây: ",5" = 500 ms. */
export function parseTimecode(s: string): number | null {
  const m = TIME.exec(s.trim());
  if (!m) return null;
  const [, h, mi, se, frac] = m;
  if (+mi > 59 || +se > 59) return null;
  return ((+h * 60 + +mi) * 60 + +se) * 1000 + Math.round(+`0.${frac}` * 1000);
}

/** Kiểm tra SRT, trả về danh sách cue và mọi lỗi (kèm số dòng), không dừng ở lỗi đầu. */
export function validateSrt(text: string): { cues: SrtCue[]; problems: SrtProblem[] } {
  const lines = text.replace(/^﻿/, '').split(/\r\n|\r|\n/);
  const cues: SrtCue[] = [];
  const problems: SrtProblem[] = [];
  let expected = 1;
  let i = 0;
  const err = (code: number, line: number, message: string) => problems.push({ code, line: line + 1, message });
  while (i < lines.length) {
    if (lines[i].trim() === '') { i++; continue; }
    const idxLine = lines[i].trim();
    if (!/^\d+$/.test(idxLine)) err(SRT_ERR.BAD_INDEX, i, `"${idxLine}" không phải số thứ tự`);
    else if (+idxLine !== expected) err(SRT_ERR.WRONG_SEQUENCE, i, `cần số ${expected}, gặp ${idxLine}`);
    // đếm tiếp từ số vừa gặp để một chỗ nhảy số không kéo theo lỗi ở mọi block sau
    expected = /^\d+$/.test(idxLine) ? +idxLine + 1 : expected + 1;
    const timing = (lines[i + 1] ?? '').trim();
    const parts = timing.split(/\s+-->\s+/);
    const start = parts.length === 2 ? parseTimecode(parts[0]) : null;
    const end = parts.length === 2 ? parseTimecode(parts[1]) : null;
    if (start === null || end === null) err(SRT_ERR.BAD_TIMING_LINE, i + 1, `dòng thời gian sai: "${timing}"`);
    else if (end <= start) err(SRT_ERR.END_BEFORE_START, i + 1, 'thời điểm kết thúc không sau thời điểm bắt đầu');
    i += 2;
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') body.push(lines[i++]);
    if (start !== null && end !== null) cues.push({ index: +idxLine, start, end, text: body.join('\n') });
  }
  return { cues, problems };
}

/** Mô phỏng VideoCaptionValidator: split(/r?\n/), so timecode bằng chuỗi, chỉ trả mã lỗi cuối. */
export function fbValidateSrt(a: string): number | null {
  let code: number | null = null, state = 0, expected = 1;
  const re = /\d{1,2}:\d{1,2}:\d{1,2}(,|\.)\d{1,3}/;
  for (const line of a.split(/r?\n/g)) {
    if (state === 0) {
      if (line.charCodeAt(0) === 0xfeff || line === '') continue;
      if (isNaN(line as unknown as number)) code = SRT_ERR.BAD_INDEX;
      else if (parseInt(line, 10) !== expected) code = SRT_ERR.WRONG_SEQUENCE;
      expected++;
      state = 1;
    } else if (state === 1) {
      const k = line.split(' ');
      if (k.length !== 3 || !re.test(k[0]) || k[1] !== '-->' || !re.test(k[2])) code = SRT_ERR.BAD_TIMING_LINE;
      else if (k[2] <= k[0]) code = SRT_ERR.END_BEFORE_START; // so sánh chuỗi
      state = 2;
    } else if (line === '') state = 0;
  }
  return code;
}

/** Chuẩn hoá trước khi so: NFKD (chữ full-width, chữ có dấu), bỏ dấu, thường hoá, gom ký tự lạ thành dấu cách. */
export function normalizeAddress(s: string) {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9\n]+/g, ' ')
    .trim();
}

const PO_BOX = new RegExp(
  '(?:' +
  [
    '\\bp ?[o0] ?b(?:ox)?\\b', // po box, p o b, pobox, p0 box
    '\\bpost(?:al)? (?:office |ofc )?box\\b',
    '\\bparcel (?:box|locker)\\b',
    '\\bp ?o(?= ?\\d)', // "PO 12"
    '\\bhop thu\\b', // "Hộp thư 12"
  ]
    .join('|') +
  ')(?: ?\\d| [a-z]*\\d| ?$)',
  'm',
);

/** Địa chỉ có phải hộp thư bưu điện (không giao hàng tận nơi) không. */
export const isPoBox = (address: string) => PO_BOX.test(normalizeAddress(address));

/** Regex của ShopUtils (trích để so sánh): chỉ thay ký tự ngoài [a-z0-9] bằng dấu cách, không chuẩn hoá Unicode. */
export function fbIsPoBox(address: string) {
  const a = address.replace(/[^a-z0-9\n]+/gi, ' ');
  return /\b(?:post(?:al)? (?:office |ofc )?bo?x|parcel (?:bo?x|locker)|po ?bo?x?|p o bo?x?|p ?o(?= ?\d))(?: ?\d| [a-z]*\d| ?$)/im.test(a);
}

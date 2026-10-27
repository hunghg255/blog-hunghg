/**
 * Parse ngày giờ người dùng tự gõ một cách "khoan dung" nhưng vẫn theo đúng thứ tự
 * ngày/tháng/năm của locale (ý tưởng từ owa-datetime/getDisplayDateParserRegExp của Outlook):
 * biến chuỗi định dạng của locale (vd `dd/MM/yyyy h:mm tt`) thành một regex có capture group,
 * cho phép bỏ khoảng trắng, gõ giờ 24h dù định dạng là 12h, bỏ AM/PM, gõ tên tháng đầy đủ
 * hoặc viết tắt, không phân biệt hoa thường.
 */

/** d: ngày, M: tháng (số), n: tên tháng, y: năm, H/h: giờ, m: phút, s: giây, t: AM/PM */
export type DateField = 'd' | 'M' | 'n' | 'y' | 'H' | 'h' | 'm' | 's' | 't';

export interface DateParser {
  format: string;
  regexp: RegExp;
  /** field tương ứng với từng capture group, theo thứ tự */
  groups: DateField[];
}

const TOKEN = /'[^']*'|dd?|MMMM|MMM|MM?|yyyy|yy|hh?|HH?|mm?|ss?|tt?|[^'dMyhHmst]+/g;
const SEPARATORS = /[./\-]/;
const TIME_SEPARATOR = ':';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Chuyển một đoạn chữ cố định trong định dạng thành regex. */
function literalToRegExp(text: string): string {
  let out = '';
  for (const char of text) {
    if (/\s/.test(char)) out += '\\s*'; // khoảng trắng (kể cả NBSP, U+202F) thành tuỳ chọn
    else if (char === TIME_SEPARATOR) out += '\\s*[:.hH]\\s*'; // 21:05, 21.05, 21h05
    // gõ / . - thay nhau đều được, nhưng PHẢI có: bỏ trống thì "7.3.2026" có thể bị
    // hiểu thành năm 20, 2 giờ 6 phút vì các nhóm số dính liền nhau
    else if (SEPARATORS.test(char)) out += '\\s*[./\\-]\\s*';
    else if (char === ',') out += '\\s*,?\\s*';
    else out += escapeRegExp(char);
  }
  return out;
}

export function buildDateParser(format: string): DateParser {
  const groups: DateField[] = [];
  let source = '^\\s*';
  for (const token of format.match(TOKEN) ?? []) {
    switch (token) {
      case 'd': case 'dd': case 'M': case 'MM':
      case 'H': case 'HH': case 'h': case 'hh':
      case 'm': case 'mm': case 's': case 'ss':
        groups.push(token[0] as DateField);
        source += '(\\d\\d?)';
        break;
      case 'MMM': case 'MMMM':
        groups.push('n');
        source += '([^\\s\\d.,/-]+)\\.?'; // "thg", "Mar.", "März"…
        break;
      case 't': case 'tt':
        groups.push('t');
        source += '([^\\s\\d]*)'; // AM/PM không bắt buộc
        break;
      case 'yy': case 'yyyy':
        groups.push('y');
        source += '(\\d{1,4})';
        break;
      default:
        // chuỗi trong nháy đơn là chữ cố định ('年'); khác bản gốc: escape MỌI ký tự đặc biệt
        source += literalToRegExp(token.startsWith("'") ? token.slice(1, -1) : token);
    }
  }
  // dồn các \s* liên tiếp cho regex gọn
  source = source.replace(/(\\s\*)+/g, '\\s*') + '\\s*$';
  return { format, regexp: new RegExp(source, 'iu'), groups };
}

export interface LocaleNames {
  /** tên tháng (viết thường, cả dạng dài lẫn ngắn) -> 0..11 */
  months: Map<string, number>;
  /** chữ AM/PM viết thường -> true nếu là buổi chiều */
  periods: Map<string, boolean>;
}

const lower = (text: string, locale: string) => text.toLocaleLowerCase(locale).replace(/\.$/, '');

/** Lấy tên tháng và chữ AM/PM của locale từ Intl, không cần tự dịch. */
export function getLocaleNames(locale: string): LocaleNames {
  const months = new Map<string, number>();
  for (const month of ['long', 'short'] as const) {
    const format = new Intl.DateTimeFormat(locale, { month, timeZone: 'UTC' });
    for (let i = 0; i < 12; i++) months.set(lower(format.format(Date.UTC(2026, i, 15)), locale), i);
  }
  const periods = new Map<string, boolean>();
  const timeFormat = new Intl.DateTimeFormat(locale, { hour: 'numeric', hour12: true, timeZone: 'UTC' });
  for (const [hour, pm] of [[9, false], [21, true]] as const) {
    const part = timeFormat.formatToParts(Date.UTC(2026, 0, 1, hour)).find((p) => p.type === 'dayPeriod');
    if (part) periods.set(lower(part.value, locale), pm);
  }
  // luôn hiểu am/pm tiếng Anh, người dùng hay gõ vậy dù giao diện là ngôn ngữ khác
  periods.set('am', false).set('pm', true).set('a', false).set('p', true);
  return { months, periods };
}

/**
 * Suy ra chuỗi định dạng từ Intl thay vì tự viết tay cho từng locale.
 * vd vi-VN -> `dd/MM/yyyy`, en-US -> `MM/dd/yyyy`, de-DE -> `dd.MM.yyyy`.
 * Trả về null nếu tên tháng của locale có chữ số (vi-VN: "tháng 3"), regex tên tháng không bắt được.
 */
export function formatFromLocale(
  locale: string,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit' },
): string | null {
  const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' });
  const hour12 = format.resolvedOptions().hour12;
  let out = '';
  for (const { type, value } of format.formatToParts(Date.UTC(2026, 10, 23, 21, 5))) {
    switch (type) {
      case 'day': out += 'dd'; break;
      case 'month':
        if (/^\d+$/.test(value)) out += 'MM';
        else if (/\d/.test(value)) return null;
        else out += 'MMMM';
        break;
      case 'year': out += 'yyyy'; break;
      case 'hour': out += hour12 ? 'h' : 'HH'; break;
      case 'minute': out += 'mm'; break;
      case 'dayPeriod': out += 'tt'; break;
      default: out += /[dMyhHmst']/.test(value) ? `'${value}'` : value;
    }
  }
  return out;
}

/**
 * Các parser cho một locale, thử lần lượt. Ngoài định dạng chuẩn của Intl (vi-VN đặt giờ
 * TRƯỚC ngày: `HH:mm dd/MM/yyyy`) còn nhận "ngày rồi giờ", chỉ ngày, ngày tháng không có năm
 * và tên tháng bằng chữ. AM/PM luôn được chấp nhận, kể cả ở locale dùng giờ 24h.
 */
export function buildLocaleParsers(locale: string): DateParser[] {
  const date = formatFromLocale(locale)!;
  const monthDay = formatFromLocale(locale, { month: '2-digit', day: '2-digit' });
  let time = formatFromLocale(locale, { hour: 'numeric', minute: '2-digit' })!;
  if (!time.includes('tt')) time += ' tt';
  const formats = [
    formatFromLocale(locale, { year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit' }),
    `${date} ${time}`,
    `${time} ${date}`,
    date,
    monthDay && `${monthDay} ${time}`,
    monthDay,
    formatFromLocale(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
    formatFromLocale(locale, { month: 'long', day: 'numeric' }),
  ];
  return [...new Set(formats.filter((f): f is string => !!f))].map(buildDateParser);
}

export type ParseResult = { ok: true; date: Date } | { ok: false; reason: string };

/**
 * Năm 2 chữ số: chọn năm gần năm tham chiếu nhất (trong khoảng ±50 năm).
 * Outlook chỉ ghép thế kỷ của năm tham chiếu: năm 2026 gõ "99" thành 2099.
 */
export function expandTwoDigitYear(yy: number, referenceYear: number): number {
  let year = referenceYear - (referenceYear % 100) + yy;
  if (year > referenceYear + 50) year -= 100;
  else if (year <= referenceYear - 50) year += 100;
  return year;
}

/** Thử từng parser, trả kết quả đầu tiên thành công (hoặc lỗi của parser khớp được). */
export function parseWithParsers(input: string, parsers: DateParser[], names: LocaleNames, reference?: Date) {
  let firstError: ParseResult | null = null;
  for (const parser of parsers) {
    const result = parseLenientDate(input, parser, names, reference);
    if (result.ok) return { ...result, parser };
    if (result.reason !== 'không khớp định dạng') firstError ??= result;
  }
  return firstError ?? { ok: false as const, reason: 'không khớp định dạng nào' };
}

/** Parse theo parser đã dựng; field nào không gõ thì lấy từ `reference` (mặc định: bây giờ). */
export function parseLenientDate(
  input: string,
  { regexp, groups }: DateParser,
  names: LocaleNames,
  reference: Date = new Date(),
): ParseResult {
  const match = regexp.exec(input.normalize('NFC'));
  if (!match) return { ok: false, reason: 'không khớp định dạng' };

  let year = reference.getFullYear();
  let month = reference.getMonth();
  let day = reference.getDate();
  let hour = 0;
  let minute = 0;
  let second = 0;
  let pm: boolean | undefined;

  for (let i = 0; i < groups.length; i++) {
    const raw = match[i + 1] ?? '';
    const value = parseInt(raw, 10);
    switch (groups[i]) {
      case 'd': day = value; break;
      case 'M': month = value - 1; break;
      case 'n': {
        const found = names.months.get(raw.toLocaleLowerCase());
        if (found === undefined) return { ok: false, reason: `không hiểu tên tháng "${raw}"` };
        month = found;
        break;
      }
      case 'y': year = raw.length <= 2 ? expandTwoDigitYear(value, reference.getFullYear()) : value; break;
      case 'H': case 'h': hour = value; break;
      case 'm': minute = value; break;
      case 's': second = value; break;
      case 't':
        if (raw) {
          pm = names.periods.get(raw.toLocaleLowerCase().replace(/\./g, ''));
          if (pm === undefined) return { ok: false, reason: `không hiểu "${raw}"` };
        }
        break;
    }
  }

  if (pm === true && hour < 12) hour += 12;
  if (pm === false && hour === 12) hour = 0;
  if (month < 0 || month > 11 || day < 1 || hour > 23 || minute > 59 || second > 59) {
    return { ok: false, reason: 'giá trị vượt giới hạn' };
  }
  const date = new Date(year, month, day, hour, minute, second);
  if (year < 100) date.setFullYear(year); // new Date(26, …) là năm 1926, không phải năm 26
  // 31/02 bị Date tự "tràn" sang tháng 3: so lại ngày để bắt lỗi này
  if (date.getDate() !== day || date.getMonth() !== month) return { ok: false, reason: `tháng ${month + 1} không có ngày ${day}` };
  return { ok: true, date };
}

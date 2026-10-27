/**
 * Tiền tệ lưu bằng đơn vị nhỏ nhất (ý tưởng từ AdsCurrencyFormatter + AdsAbstractCurrencyInput
 * của Facebook Ads Manager).
 *
 * - Giá trị luôn là số nguyên theo "offset" của loại tiền: USD offset 100 (cent), JPY offset 1,
 *   BHD offset 1000. Số chữ số thập phân = log10(offset).
 * - Hiển thị qua template riêng từng loại tiền ("{symbol}{amount}" hay "{amount} {symbol}").
 * - "Ít nhất một chữ số có nghĩa": 0,3 cent hiện là $0.003 chứ không phải $0.00.
 * - Ô nhập giữ chuỗi người dùng đang gõ (dirty value), chỉ parse khi blur/Enter.
 */

export interface CurrencyInfo {
  code: string;
  /** số đơn vị nhỏ nhất trong 1 đơn vị tiền */
  offset: number;
  symbol: string;
  template: string;
}

export const CURRENCIES: Record<string, CurrencyInfo> = {
  USD: { code: 'USD', offset: 100, symbol: '$', template: '{symbol}{amount}' },
  EUR: { code: 'EUR', offset: 100, symbol: '€', template: '{amount} {symbol}' },
  JPY: { code: 'JPY', offset: 1, symbol: '¥', template: '{symbol}{amount}' },
  VND: { code: 'VND', offset: 1, symbol: '₫', template: '{amount} {symbol}' },
  BHD: { code: 'BHD', offset: 1000, symbol: 'BD', template: '{symbol} {amount}' },
};

export function decimalsOf(offset: number) {
  return Math.round(Math.log10(offset));
}

/** Dấu thập phân và dấu ngăn nghìn của locale, lấy từ chính Intl. */
export function separatorsOf(locale: string) {
  const parts = new Intl.NumberFormat(locale).formatToParts(1234567.5);
  return {
    decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    group: parts.find((p) => p.type === 'group')?.value ?? ',',
  };
}

function formatNumber(value: number, decimals: number, locale: string, grouping = true) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  }).format(value);
}

export function applyTemplate(currency: CurrencyInfo, amount: string) {
  return currency.template.replace('{symbol}', currency.symbol).replace('{amount}', amount);
}

/** Định dạng đầy đủ: số lẻ cố định theo offset. */
export function formatMinor(minor: number, currency: CurrencyInfo, locale: string) {
  return applyTemplate(currency, formatNumber(minor / currency.offset, decimalsOf(currency.offset), locale));
}

/** Bỏ phần lẻ khi chia hết: $5 thay vì $5.00, nhưng $5.20 vẫn giữ đủ hai số lẻ. */
export function formatMinorOptionalDecimals(minor: number, currency: CurrencyInfo, locale: string) {
  const decimals = minor % currency.offset === 0 ? 0 : decimalsOf(currency.offset);
  return applyTemplate(currency, formatNumber(minor / currency.offset, decimals, locale));
}

/** Số chữ số lẻ tối thiểu để giá trị khác 0 không bị làm tròn thành 0. */
export function decimalsForOneSigFig(minor: number, offset: number) {
  let decimals = decimalsOf(offset);
  // giới hạn 20 cho chắc: Intl chỉ nhận tối đa 20 chữ số lẻ
  while (minor !== 0 && Number.isFinite(minor) && decimals < 20 && Math.round((Math.abs(minor) * 10 ** decimals) / offset) < 1) {
    decimals++;
  }
  return decimals;
}

export function formatMinorAtLeastOneSigFig(minor: number, currency: CurrencyInfo, locale: string) {
  return applyTemplate(currency, formatNumber(minor / currency.offset, decimalsForOneSigFig(minor, currency.offset), locale));
}

/** Rút gọn K/M, dùng ngưỡng >= (1 000 000 là 1M) và vẫn đi qua template của loại tiền. */
export function formatMinorCompact(minor: number, currency: CurrencyInfo, locale: string) {
  const value = minor / currency.offset;
  const abs = Math.abs(value);
  // làm tròn trước khi chọn đơn vị: 999 950 làm tròn 1 số lẻ theo K là 1000.0K, nên phải lên M
  const unit = abs >= 999_950 ? { div: 1e6, suffix: 'M' } : abs >= 1_000 ? { div: 1e3, suffix: 'K' } : null;
  if (!unit) return formatMinorOptionalDecimals(minor, currency, locale);
  const short = Math.round((value / unit.div) * 10) / 10;
  return applyTemplate(currency, formatNumber(short, 1, locale) + unit.suffix);
}

/** Cách rút gọn của bản gốc: ngưỡng ">" và ký hiệu tiền luôn đứng trước, bỏ qua template. */
export function fbStyleCompact(minor: number, currency: CurrencyInfo) {
  let value = minor / currency.offset;
  let suffix = '';
  if (value > 1e6) {
    value /= 1e6;
    suffix = 'M';
  } else if (value > 1e3) {
    value /= 1e3;
    suffix = 'K';
  } else {
    return formatMinorOptionalDecimals(minor, currency, 'en-US');
  }
  value = Math.round(value * 10) / 10;
  return currency.symbol + value.toFixed(1) + suffix;
}

/** Regex cho chuỗi đang gõ: ký tự không phải số ở hai đầu, dấu ngăn nghìn của locale, tối đa 8 số lẻ. */
export function inputPattern(locale: string) {
  const { decimal, group } = separatorsOf(locale);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // khoảng trắng hẹp (fr-FR, ru-RU…) khó gõ: chấp nhận cả khoảng trắng thường
  const groupClass = /\s/.test(group) ? `${esc(group)} ` : esc(group);
  return new RegExp(`^\\D*[${groupClass}\\d]*${esc(decimal)}?\\d{0,8}\\D*$`);
}

/**
 * Parse chuỗi người dùng gõ ra số nguyên đơn vị nhỏ nhất, null nếu không hợp lệ.
 * Làm tròn tới đơn vị nhỏ nhất: "0,003" USD → 0 cent (giống bản gốc, Math.round).
 */
export function parseToMinor(text: string, currency: CurrencyInfo, locale: string): number | null {
  if (!inputPattern(locale).test(text)) return null;
  const { decimal, group } = separatorsOf(locale);
  const cleaned = text
    .replace(/[^\d\-\s.,'’  ]/g, '')
    .split(group)
    .join('')
    .replace(/[\s  ]/g, '')
    .replace(decimal, '.');
  if (!/\d/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * currency.offset);
}

/**
 * Bắt "dán hai lần liên tiếp" (bản gốc dùng để mở chế độ dán nhiều giá trị).
 * Bản gốc: lần dán thứ hai đến chậm thì xoá mốc thời gian về null, nên lần dán thứ ba
 * (dù sát ngay sau) lại bị coi là lần đầu. Ở đây lần dán chậm trở thành mốc mới.
 */
export function createDoublePasteDetector(windowMs = 500, now: () => number = Date.now) {
  let last: number | null = null;
  return function onPaste(): boolean {
    const t = now();
    if (last !== null && t - last < windowMs) {
      last = null;
      return true;
    }
    last = t;
    return false;
  };
}

export function createFbStyleDoublePasteDetector(windowMs = 500, now: () => number = Date.now) {
  let pasteTime: number | null = null;
  return function onPaste(): boolean {
    if (!pasteTime) {
      pasteTime = now();
      return false;
    }
    const fired = now() - pasteTime < windowMs;
    pasteTime = null;
    return fired;
  };
}

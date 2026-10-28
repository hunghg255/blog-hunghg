/**
 * Mô phỏng lại cách WhatsApp Web 2020 (module bjgiedaj) đọc giá tiền, giữ nguyên các phép tính
 * để demo cho thấy chỗ sai. Viết lại bằng TypeScript cho demo, không phải mã gốc.
 */

/** dấu thập phân = ký tự thứ 2 của format(1.1) */
const decimalChar = (locale: string) => new Intl.NumberFormat(locale).format(1.1).substring(1, 2);
/** "dấu nhóm" = ký tự thứ 2 của format(1000) — với es/pl là "0" vì 4 chữ số không được nhóm */
export const groupCharOriginal = (locale: string) => new Intl.NumberFormat(locale).format(1e3).substr(1, 1);
/** ký hiệu = format(0) bỏ phần số */
const symbol = (locale: string, currency: string) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(0).replace(/\d+([,.]\d+)?/g, '').trim();

export function valueFromStringOriginal(locale: string, currency: string, input: string) {
  const r = input.replace(symbol(locale, currency), '').trim();
  // replace không có cờ g: chỉ bỏ dấu nhóm ĐẦU TIÊN; parseFloat dừng ở ký tự lạ đầu tiên
  return Math.round(1e3 * parseFloat(r.replace(groupCharOriginal(locale), '')));
}

/** CURRENCY_DIGITS rút gọn từ module dgbiieecah (mặc định 2) */
const DIGITS: Record<string, number> = { JPY: 0, VND: 0, KRW: 0, KWD: 3, BHD: 3 };

export function validatePriceOriginal(locale: string, currency: string, input: string) {
  const digits = DIGITS[currency] ?? 2;
  const s = valueFromStringOriginal(locale, currency, input);
  const trimmed = input.replace(/\D+$/g, '');
  return !(s > 4503599627370496 || s < 1 || isNaN(s) || trimmed !== input || (input.split(decimalChar(locale))[1] || '').length > digits);
}

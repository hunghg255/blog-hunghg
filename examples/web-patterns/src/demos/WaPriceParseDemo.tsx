import { useMemo, useState } from 'react';
import { formatPrice, numberSymbols, parsePrice, type ParseResult } from '../lib/waPriceParse';
import { groupCharOriginal, validatePriceOriginal, valueFromStringOriginal } from './WaPriceOriginal';
import './WaPriceParseDemo.css';

/** [locale, tiền tệ, chuỗi người dùng gõ, số tiền họ muốn (đơn vị phần nghìn)] */
const CASES: [string, string, string, number][] = [
  ['en-US', 'USD', '1,050.50', 1050500],
  ['en-US', 'USD', '1,000,000', 1000000000],
  ['es-ES', 'EUR', '1050,5', 1050500],
  ['pl-PL', 'PLN', '1050,5', 1050500],
  ['de-DE', 'EUR', '1.050,50', 1050500],
  ['fr-FR', 'EUR', '1 050,50', 1050500],
  ['vi-VN', 'VND', '1.000.000', 1000000000],
  ['id-ID', 'IDR', 'Rp 25.000', 25000000],
  ['en-IN', 'INR', '1,00,000', 100000000],
  ['ar-EG', 'EGP', '١٠٥٠٫٥', 1050500],
];
const LOCALES = ['vi-VN', 'en-US', 'es-ES', 'pl-PL', 'de-DE', 'fr-FR', 'id-ID', 'en-IN', 'ar-EG', 'ja-JP', 'de-CH'];
const CURRENCIES = ['VND', 'USD', 'EUR', 'PLN', 'IDR', 'INR', 'EGP', 'JPY', 'CHF', 'KWD'];
const REASONS: Record<string, string> = {
  empty: 'trống',
  chars: 'ký tự lạ',
  group: 'dấu nhóm sai chỗ',
  decimals: 'quá nhiều số lẻ',
  range: 'ngoài khoảng cho phép',
};

const show = (locale: string, currency: string, amount1000: number) =>
  Number.isFinite(amount1000) ? formatPrice(amount1000, locale, currency) : 'NaN';
const mine = (r: ParseResult, locale: string, currency: string) => (r.ok ? show(locale, currency, r.amount1000) : `✗ ${REASONS[r.reason]}`);

function Row({ locale, currency, input, want }: { locale: string; currency: string; input: string; want?: number }) {
  const orig = valueFromStringOriginal(locale, currency, input);
  const valid = validatePriceOriginal(locale, currency, input);
  const res = parsePrice(input, numberSymbols(locale, currency));
  const origOk = want === undefined ? undefined : valid && orig === want;
  const mineOk = want === undefined ? undefined : res.ok && res.amount1000 === want;
  const tone = (ok?: boolean) => (ok === undefined ? '' : ok ? 'ok' : 'err');
  return (
    <tr>
      <td>
        <code>{locale}</code> {currency}
      </td>
      <td>
        <code>{input || '—'}</code>
      </td>
      <td className={tone(origOk)}>
        {show(locale, currency, orig)}
        <small>{valid ? 'hợp lệ' : 'bị từ chối'}</small>
      </td>
      <td className={tone(mineOk)}>{mine(res, locale, currency)}</td>
    </tr>
  );
}

export default function WaPriceParseDemo() {
  const [locale, setLocale] = useState('vi-VN');
  const [currency, setCurrency] = useState('VND');
  const [input, setInput] = useState('1.250.000');
  const sym = useMemo(() => numberSymbols(locale, currency), [locale, currency]);
  const fmt = (c: string) => JSON.stringify(c).slice(1, -1) + (c && c.charCodeAt(0) > 127 ? ` (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})` : '');

  return (
    <div className='page wpc-page'>
      <h1>Parse giá tiền theo locale bằng Intl</h1>
      <p className='hint'>
        Cột "kiểu WhatsApp" chạy lại đúng các phép tính của module bjgiedaj (WhatsApp Web 2020): lấy dấu nhóm là ký tự thứ 2 của{' '}
        <code>format(1000)</code>, bỏ dấu nhóm đầu tiên rồi <code>parseFloat</code>. Cột "viết lại" dùng <code>formatToParts</code> và ghép chữ
        số, không qua số thực.
      </p>
      <div className='card wpc-card'>
        <div className='toolbar'>
          <select value={locale} onChange={(e) => setLocale(e.target.value)} aria-label='locale'>
            {LOCALES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label='tiền tệ'>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <input value={input} onChange={(e) => setInput(e.target.value)} aria-label='giá' className='wpc-input' />
        </div>
        <div className='wpc-syms'>
          <span>
            dấu nhóm: <code>{fmt(sym.group)}</code>
          </span>
          <span>
            thập phân: <code>{fmt(sym.decimal)}</code>
          </span>
          <span>
            ký hiệu: <code>{sym.currency}</code>
          </span>
          <span>
            số lẻ: <code>{sym.fractionDigits}</code>
          </span>
          <span>
            "dấu nhóm" của bản gốc: <code>{fmt(groupCharOriginal(locale))}</code>
          </span>
        </div>
        <div className='wpc-table'>
          <table>
            <thead>
              <tr>
                <th>Locale</th>
                <th>Người dùng gõ</th>
                <th>Kiểu WhatsApp</th>
                <th>Viết lại</th>
              </tr>
            </thead>
            <tbody>
              <Row locale={locale} currency={currency} input={input} />
            </tbody>
          </table>
        </div>
      </div>
      <h2 className='wpc-h2'>Các trường hợp mẫu</h2>
      <div className='wpc-table'>
        <table>
          <thead>
            <tr>
              <th>Locale</th>
              <th>Người dùng gõ</th>
              <th>Kiểu WhatsApp</th>
              <th>Viết lại</th>
            </tr>
          </thead>
          <tbody>
            {CASES.map(([l, c, s, want]) => (
              <Row key={l + s} locale={l} currency={c} input={s} want={want} />
            ))}
          </tbody>
        </table>
      </div>
      <p className='hint'>Kết quả phụ thuộc dữ liệu CLDR của trình duyệt; bảng trên đúng với Chrome/Node bản 2026.</p>
    </div>
  );
}

import { useRef, useState } from 'react';
import {
  CURRENCIES,
  createDoublePasteDetector,
  createFbStyleDoublePasteDetector,
  decimalsOf,
  fbStyleCompact,
  formatMinor,
  formatMinorAtLeastOneSigFig,
  formatMinorCompact,
  formatMinorOptionalDecimals,
  inputPattern,
  parseToMinor,
  type CurrencyInfo,
} from '../lib/currency';
import { Log, Stat, useLog } from './shared';
import './CurrencyDemo.css';

const LOCALES = ['vi-VN', 'en-US', 'de-DE', 'fr-FR'];

/**
 * Ô nhập tiền kiểu "dirty value": khi đang gõ thì hiện đúng chuỗi người dùng gõ, chỉ parse
 * và format lại khi blur hoặc Enter.
 */
function CurrencyInput({
  value,
  currency,
  locale,
  onCommit,
  onPaste,
}: {
  value: number | null;
  currency: CurrencyInfo;
  locale: string;
  onCommit: (minor: number | null, raw: string) => void;
  onPaste?: () => void;
}) {
  const [dirty, setDirty] = useState<string | null>(null);
  const shown = dirty ?? (value == null ? '' : formatMinor(value, currency, locale));
  const invalid = dirty !== null && dirty !== '' && !inputPattern(locale).test(dirty);
  const commit = () => {
    if (dirty === null) return;
    onCommit(parseToMinor(dirty, currency, locale), dirty);
    setDirty(null);
  };
  return (
    <div className='cu-input'>
      <input
        value={shown}
        inputMode='decimal'
        aria-invalid={invalid}
        aria-label={`Ngân sách (${currency.code})`}
        onChange={(e) => setDirty(e.target.value)}
        onBlur={commit}
        onKeyUp={(e) => e.key === 'Enter' && commit()}
        onPaste={onPaste}
      />
      <span className='cu-code'>{currency.code}</span>
      {invalid && <small className='err'>Ngân sách phải là một số hợp lệ.</small>}
    </div>
  );
}

const COMPACT_SAMPLES = [999_499_00, 999_950_00, 1_000_000_00, 12_345_678_00];

export default function CurrencyDemo() {
  const { lines, add } = useLog(30);
  const [code, setCode] = useState('USD');
  const [locale, setLocale] = useState('vi-VN');
  const [minor, setMinor] = useState<number | null>(1_234_56);
  const [impressions, setImpressions] = useState(250_000);
  const [pasteResult, setPasteResult] = useState('—');
  const newDetector = useRef(createDoublePasteDetector());
  const fbDetector = useRef(createFbStyleDoublePasteDetector());
  const currency = CURRENCIES[code];

  const switchCurrency = (next: string) => {
    // đổi loại tiền thì đổi luôn đơn vị nhỏ nhất: 1 234,56 USD = 123 456 cent → 1 234,560 BHD = 1 234 560 fils
    if (minor != null) setMinor(Math.round((minor / currency.offset) * CURRENCIES[next].offset));
    setCode(next);
  };

  const onPaste = () => {
    const a = newDetector.current();
    const b = fbDetector.current();
    setPasteResult(`bản viết lại: ${a ? 'BẮT ĐƯỢC' : '—'} · bản gốc: ${b ? 'BẮT ĐƯỢC' : '—'}`);
    add(`dán: bản viết lại ${a ? 'bắt được dán đôi' : 'chưa'}, bản gốc ${b ? 'bắt được dán đôi' : 'chưa'}`, a || b ? 'ok' : 'muted');
  };

  /** dán theo nhịp cố định để thấy khác biệt: 0 s, 2 s (chậm), 2,1 s (nhanh) */
  const simulatePastes = () => {
    let t = 10_000;
    const clock = () => t;
    const a = createDoublePasteDetector(500, clock);
    const b = createFbStyleDoublePasteDetector(500, clock);
    const rows = [0, 2000, 2100].map((offset) => {
      t = 10_000 + offset;
      return `dán lúc ${offset / 1000}s → viết lại: ${a() ? 'bắt' : '—'}, gốc: ${b() ? 'bắt' : '—'}`;
    });
    rows.forEach((r) => add(r, r.includes('viết lại: bắt') && r.includes('gốc: —') ? 'warn' : 'muted'));
  };

  // giá mỗi lượt hiển thị = ngân sách / số lượt, thường nhỏ hơn 1 đơn vị nhỏ nhất
  const perImpression = minor == null ? 0 : minor / impressions;

  return (
    <div className='page cu'>
      <h1>Tiền tệ theo đơn vị nhỏ nhất</h1>
      <p className='hint'>
        Giá trị lưu là số nguyên theo đơn vị nhỏ nhất của loại tiền (cent, yên, fils…). Gõ số theo định dạng của locale
        đang chọn, bấm Enter hoặc rời ô để lưu. Trong lúc gõ, ô giữ nguyên chuỗi bạn gõ.
      </p>
      <div className='toolbar'>
        <label>
          Loại tiền{' '}
          <select value={code} onChange={(e) => switchCurrency(e.target.value)}>
            {Object.values(CURRENCIES).map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} (offset {c.offset})
              </option>
            ))}
          </select>
        </label>
        <label>
          Locale{' '}
          <select value={locale} onChange={(e) => setLocale(e.target.value)}>
            {LOCALES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>

      <CurrencyInput
        key={`${code}-${locale}`}
        value={minor}
        currency={currency}
        locale={locale}
        onCommit={(value, raw) => {
          add(`lưu "${raw}" → ${value == null ? 'không hợp lệ, giữ giá trị cũ' : `${value} đơn vị nhỏ nhất`}`, value == null ? 'err' : 'ok');
          if (value != null) setMinor(value);
        }}
        onPaste={onPaste}
      />

      <div className='stats'>
        <Stat label='giá trị lưu (số nguyên)' value={<bdi>{minor ?? '—'}</bdi>} />
        <Stat label='số chữ số lẻ = log10(offset)' value={<bdi>{decimalsOf(currency.offset)}</bdi>} />
        <Stat label='đầy đủ' value={<bdi>{minor == null ? '—' : formatMinor(minor, currency, locale)}</bdi>} />
        <Stat label='bỏ số lẻ nếu chẵn' value={<bdi>{minor == null ? '—' : formatMinorOptionalDecimals(minor, currency, locale)}</bdi>} />
      </div>

      <h2>Ít nhất một chữ số có nghĩa</h2>
      <label className='cu-range'>
        Số lượt hiển thị: <b>{impressions.toLocaleString(locale)}</b>
        <input type='range' min={1000} max={5_000_000} step={1000} value={impressions} onChange={(e) => setImpressions(Number(e.target.value))} />
      </label>
      <div className='stats'>
        <Stat label='mỗi lượt, số lẻ cố định' value={<bdi>{formatMinor(perImpression, currency, locale)}</bdi>} />
        <Stat label='mỗi lượt, ≥ 1 chữ số có nghĩa' value={<bdi className='ok'>{formatMinorAtLeastOneSigFig(perImpression, currency, locale)}</bdi>} />
      </div>

      <h2>Rút gọn K/M</h2>
      <table className='cu-table'>
        <thead>
          <tr>
            <th>Giá trị</th>
            <th>Kiểu bản gốc</th>
            <th>Bản viết lại</th>
          </tr>
        </thead>
        <tbody>
          {COMPACT_SAMPLES.map((v) => {
            const value = Math.round((v / 100) * currency.offset);
            return (
              <tr key={v}>
                <td>{formatMinor(value, currency, locale)}</td>
                <td className={fbStyleCompact(value, currency).includes('1000.0K') ? 'err' : undefined}>{fbStyleCompact(value, currency)}</td>
                <td>{formatMinorCompact(value, currency, locale)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Dán hai lần liên tiếp</h2>
      <p className='hint'>
        Dán vào ô ngân sách hai lần thật nhanh (dưới 500 ms) để "mở chế độ dán nhiều giá trị". Bản gốc xoá mốc thời gian
        sau một lần dán chậm, nên cặp dán nhanh ngay sau đó bị bỏ lỡ.
      </p>
      <div className='toolbar'>
        <button onClick={simulatePastes}>Mô phỏng dán lúc 0 s, 2 s, 2,1 s</button>
        <span className='muted'>{pasteResult}</span>
      </div>
      <Log lines={lines} />
    </div>
  );
}

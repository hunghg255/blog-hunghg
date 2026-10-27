import { useLayoutEffect, useRef, useState } from 'react';
import {
  caretAfterFormat,
  detectCardType,
  detectCardTypeLikeOriginal,
  formatCardNumber,
  validateCardNumber,
  validateLikeOriginal,
} from '../lib/cardValidation';
import './CardValidationDemo.css';

/** Toàn bộ là số thẻ TEST công khai (Stripe, tài liệu các hãng), không phải thẻ thật. */
const SAMPLES: Array<[string, string]> = [
  ['Visa', '4242 4242 4242 4242'],
  ['Visa có dấu cách đầu', ' 4111 1111 1111 1111'],
  ['Visa 19 số', '4111 1111 1111 1111 110'],
  ['Mastercard dải 2-series', '2223 0031 2200 3222'],
  ['Amex', '3782 822463 10005'],
  ['UnionPay 19 số', '6205 5000 0000 0000 004'],
  ['Elo (BIN 506731)', '5067 3100 0000 0010'],
  ['Diners (không hỗ trợ)', '3056 930902 5904'],
  ['Sai checksum', '4242 4242 4242 4241'],
];

const REASONS: Record<string, string> = {
  incomplete: 'chưa đủ số',
  length: 'quá dài',
  checksum: 'sai checksum (Luhn)',
  unsupported: 'hãng không hỗ trợ',
};

export default function CardValidationDemo() {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value;
    const formatted = formatCardNumber(raw);
    pendingCaret.current = caretAfterFormat(raw, e.target.selectionStart ?? raw.length, formatted);
    setValue(formatted);
  }

  const type = detectCardType(value);
  const check = validateCardNumber(value);
  const empty = value.trim() === '';

  return (
    <div className='page card-demo'>
      <h1>Validate số thẻ</h1>
      <p className='hint'>
        Gõ hoặc dán số thẻ test. Chữ <code>l</code>, <code>I</code>, <code>O</code> (lỗi hay gặp khi
        OCR) được đổi thành số; nhóm số đổi theo hãng; Luhn được kiểm ngay khi đủ độ dài.
      </p>
      <div className='card cv-card'>
        <label htmlFor='cv-number'>Số thẻ</label>
        <div className='cv-row'>
          <input
            id='cv-number'
            ref={inputRef}
            inputMode='numeric'
            autoComplete='cc-number'
            value={value}
            onChange={onChange}
            placeholder='1234 5678 9012 3456'
            aria-describedby='cv-status'
            aria-invalid={!empty && !check.ok && check.reason !== 'incomplete'}
          />
          <span className={`badge cv-brand cv-${type.brand}`} data-testid='brand'>
            {type.label}
          </span>
        </div>
        <div
          id='cv-status'
          className={empty ? 'muted' : check.ok ? 'ok' : 'warn'}
          data-testid='status'
        >
          {empty
            ? 'Chưa nhập'
            : check.ok
              ? `Hợp lệ · CSC ${type.cscDigits} số`
              : REASONS[check.reason]}
        </div>
        <div className='toolbar'>
          <button onClick={() => setValue(formatCardNumber('4lll 1l1l llll llll'))}>
            Dán từ OCR: 4lll 1l1l…
          </button>
          <button onClick={() => setValue('')}>Xoá</button>
        </div>
      </div>

      <h2 className='cv-h2'>So với bản gốc</h2>
      <div className='cv-table-wrap'>
        <table className='cv-table'>
          <thead>
            <tr>
              <th>Số thẻ test</th>
              <th>Icon (gốc)</th>
              <th>Icon (mới)</th>
              <th>Hợp lệ (gốc)</th>
              <th>Hợp lệ (mới)</th>
            </tr>
          </thead>
          <tbody>
            {SAMPLES.map(([label, n]) => {
              const origType = detectCardTypeLikeOriginal(n).brand;
              const newType = detectCardType(n).brand;
              const origOk = validateLikeOriginal(n);
              const newOk = validateCardNumber(n).ok;
              return (
                <tr key={label}>
                  <td>
                    <button className='cv-link' onClick={() => setValue(formatCardNumber(n))}>
                      {label}
                    </button>
                  </td>
                  <td className={origType !== newType ? 'err' : ''}>{origType}</td>
                  <td>{newType}</td>
                  <td className={origOk !== newOk ? 'err' : ''}>{origOk ? '✓' : '✗'}</td>
                  <td>{newOk ? '✓' : '✗'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

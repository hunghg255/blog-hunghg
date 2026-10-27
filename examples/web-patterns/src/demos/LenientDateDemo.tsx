import { useMemo, useState } from 'react';
import { buildLocaleParsers, getLocaleNames, parseWithParsers } from '../lib/lenientDate';
import { formatDuration, parseDuration } from '../lib/lenientDateDuration';
import './LenientDateDemo.css';

const LOCALES = {
  'vi-VN': ['07/03/2026 21:05', '7-3-26 9:05 CH', '21:05 7.3.2026', '7/3 21h05', '31/02/2026', '7/3/99'],
  'en-US': ['3/7/2026, 9:05 PM', '3/7/26 9:05pm', '3-7-2026 21:05', 'March 7', '2/31/2026'],
  'en-GB': ['07/03/2026 21:05', '7.3.26 9:05 pm', '7 March 2026'],
  'de-DE': ['07.03.2026 21:05', '7.3.26', '7. März 2026'],
  'ja-JP': ['2026/3/7 21:05', '2026-03-07', '2026年3月7日'],
} as const;
type Locale = keyof typeof LOCALES;

/** Bản gốc lib/weirdTime.ts của Elastic (rút gọn, giữ nguyên logic) để so sánh. */
function elasticParse(time: string | number | undefined) {
  if (!time || time === 'default') return 30 * 60_000;
  if (typeof time !== 'string') return time; // Elastic: chia 1000 rồi nhân lại 1000
  const [, rawValue, unit] = time.match(/(\d*)\s?(\w*)/)!;
  const value = parseInt(rawValue, 10);
  if (unit.startsWith('m')) return value * 60_000;
  if (unit.startsWith('h')) return value * 3_600_000;
  if (unit.startsWith('d')) return value * 86_400_000;
  return value * 1000; // còn lại: coi là giây
}

const DURATIONS = ['2h', '45min', '1d', '500ms', '1.5h', '1 week', 'h', 'abc', '1h30m', '2 giờ 15 phút'];

const show = (ms: number) => (Number.isNaN(ms) ? 'NaN' : formatDuration(ms));

export default function LenientDateDemo() {
  const [locale, setLocale] = useState<Locale>('vi-VN');
  const [input, setInput] = useState<string>(LOCALES['vi-VN'][0]);
  const [duration, setDuration] = useState('1h30m');
  const parsers = useMemo(() => buildLocaleParsers(locale), [locale]);
  const names = useMemo(() => getLocaleNames(locale), [locale]);
  const result = parseWithParsers(input, parsers, names);
  const naive = new Date(input);
  const fmt = new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' });
  const ours = parseDuration(duration);
  const theirs = elasticParse(duration);

  return (
    <div className='page ld-demo'>
      <h1>Parse ngày giờ khoan dung</h1>
      <p className='hint'>
        Định dạng lấy từ <code>Intl.DateTimeFormat</code> của locale rồi biến thành regex: khoảng trắng tuỳ chọn, gõ{' '}
        <code>/ . -</code> thay nhau được, AM/PM không bắt buộc, giờ 24h vẫn nhận. So với <code>new Date(chuỗi)</code>{' '}
        của trình duyệt: không biết locale, Chromium đọc 07/03/2026 thành ngày 3 tháng 7.
      </p>
      <div className='toolbar'>
        <select
          value={locale}
          aria-label='Locale'
          onChange={(e) => {
            const next = e.target.value as Locale;
            setLocale(next);
            setInput(LOCALES[next][0]);
          }}
        >
          {Object.keys(LOCALES).map((l) => (
            <option key={l}>{l}</option>
          ))}
        </select>
        <input type='text' value={input} onChange={(e) => setInput(e.target.value)} aria-label='Ngày giờ' className='ld-input' />
      </div>
      <div className='toolbar ld-chips'>
        {LOCALES[locale].map((s) => (
          <button key={s} onClick={() => setInput(s)} className={s === input ? 'primary' : ''}>
            {s}
          </button>
        ))}
      </div>

      <div className='ld-grid'>
        <div className='card'>
          <div className='ld-label'>Parser khoan dung</div>
          {result.ok ? (
            <>
              <div className='ok ld-value'>{fmt.format(result.date)}</div>
              <div className='ld-small muted'>
                khớp định dạng <code>{result.parser.format}</code>
              </div>
              <code className='ld-regex'>{result.parser.regexp.source}</code>
            </>
          ) : (
            <div className='err ld-value'>{result.reason}</div>
          )}
        </div>
        <div className='card'>
          <div className='ld-label'>new Date(chuỗi)</div>
          <div className={`ld-value ${Number.isNaN(naive.getTime()) ? 'err' : 'warn'}`}>
            {Number.isNaN(naive.getTime()) ? 'Invalid Date' : fmt.format(naive)}
          </div>
          <div className='ld-small muted'>kết quả tuỳ trình duyệt, không theo locale</div>
        </div>
      </div>

      <details className='ld-formats'>
        <summary>{parsers.length} định dạng được thử cho {locale}</summary>
        <ul>
          {parsers.map((p) => (
            <li key={p.format}>
              <code>{p.format}</code>
            </li>
          ))}
        </ul>
      </details>

      <h2 className='ld-h2'>Khoảng thời gian: Elastic gốc và bản sửa</h2>
      <div className='toolbar'>
        <input type='text' value={duration} onChange={(e) => setDuration(e.target.value)} aria-label='Khoảng thời gian' className='ld-input' />
        <span>
          gốc: <b className={theirs === (ours.ok ? ours.ms : NaN) ? 'ok' : 'warn'}>{show(theirs)}</b> · sửa:{' '}
          <b className={ours.ok ? 'ok' : 'err'}>{ours.ok ? formatDuration(ours.ms) : ours.reason}</b>
        </span>
      </div>
      <table className='ld-table'>
        <thead>
          <tr>
            <th>Chuỗi</th>
            <th>weirdTime.ts gốc</th>
            <th>parseDuration</th>
          </tr>
        </thead>
        <tbody>
          {DURATIONS.map((d) => {
            const a = elasticParse(d);
            const b = parseDuration(d);
            const same = b.ok && a === b.ms;
            return (
              <tr key={d} onClick={() => setDuration(d)}>
                <td>
                  <code>{d}</code>
                </td>
                <td className={same ? '' : 'warn'}>{show(a)}</td>
                <td className={b.ok ? 'ok' : 'err'}>{b.ok ? formatDuration(b.ms) : b.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

import { useState } from 'react';
import {
  combineDateAndTime,
  fbCombineDateAndTime,
  fbFormatDollars,
  fbFormatSalary,
  fbIsPoBox,
  fbRadiusAllowed,
  fbUnformatDollars,
  fbValidateSrt,
  formatMoney,
  groupDigits,
  isPoBox,
  parseLocaleNumber,
  radiusAllowed,
  validateSrt,
  type DistanceUnit,
} from '../lib/localeBugs';
import { Stat } from './shared';
import './LocaleBugsDemo.css';

const LOCALES = ['vi-VN', 'en-US', 'de-DE', 'fr-FR'];

export default function LocaleBugsDemo() {
  const [tab, setTab] = useState<'money' | 'cond' | 'text'>('money');
  return (
    <div className='page locale-demo'>
      <h1>Bug định dạng số và kiểm tra dữ liệu theo locale</h1>
      <div className='toolbar' role='tablist'>
        {(
          [
            ['money', '1. Số tiền'],
            ['cond', '2. Điều kiện, ngày'],
            ['text', '3. Phụ đề, địa chỉ'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role='tab' aria-selected={tab === k} className={tab === k ? 'primary' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'money' && <MoneyTab />}
      {tab === 'cond' && <CondTab />}
      {tab === 'text' && <TextTab />}
    </div>
  );
}

function Cmp({ fb, fixed, testId }: { fb: string; fixed: string; testId?: string }) {
  const same = fb === fixed;
  return (
    <>
      <td className={same ? '' : 'err'} data-testid={testId ? `${testId}-fb` : undefined}>
        {fb}
      </td>
      <td className='ok' data-testid={testId ? `${testId}-fixed` : undefined}>
        {fixed}
      </td>
    </>
  );
}

function MoneyTab() {
  const [locale, setLocale] = useState('vi-VN');
  const [raw, setRaw] = useState('1234567.567');
  const salaries: Array<[number, string]> = [
    [25000, 'VND'],
    [1000000, 'VND'],
    [25, 'USD'],
    [1000, 'USD'],
    [1000, 'EUR'],
    [12.5, 'USD'],
  ];
  const grouped = groupDigits(raw, locale);
  const fbFormatted = fbFormatDollars(raw);
  return (
    <section>
      <div className='toolbar'>
        <label>
          Locale người xem
          <select value={locale} onChange={(e) => setLocale(e.target.value)} data-testid='locale'>
            {LOCALES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
      </div>
      <p className='hint'>
        Lương trong tin tuyển dụng. Bản gốc định dạng số theo locale rồi <code>.replace(".00", "")</code> để bỏ phần lẻ; bản sửa quyết
        định số chữ số lẻ trước khi gọi <code>Intl.NumberFormat</code>.
      </p>
      <table className='lb-table'>
        <thead>
          <tr>
            <th>Số tiền</th>
            <th>Bản gốc</th>
            <th>Bản sửa</th>
          </tr>
        </thead>
        <tbody>
          {salaries.map(([n, c], i) => (
            <tr key={i}>
              <td>
                {n} {c}
              </td>
              <Cmp fb={fbFormatSalary(n, c, locale)} fixed={formatMoney(n, c, locale)} testId={`salary-${i}`} />
            </tr>
          ))}
        </tbody>
      </table>
      <p className='hint'>
        Ô nhập tiền trong trang hoá đơn: chèn dấu nhóm nghìn khi gõ, rồi đọc lại thành số để gửi đi. Bản gốc luôn dùng dấu phẩy
        và đếm cả chữ số phần lẻ.
      </p>
      <div className='toolbar'>
        <label>
          Gõ số (dấu chấm là dấu thập phân)
          <input value={raw} onChange={(e) => setRaw(e.target.value)} data-testid='raw' />
        </label>
      </div>
      <table className='lb-table'>
        <thead>
          <tr>
            <th></th>
            <th>Bản gốc</th>
            <th>Bản sửa</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Hiển thị</td>
            <Cmp fb={fbFormatted} fixed={grouped} testId='dollars' />
          </tr>
          <tr>
            <td>Đọc lại</td>
            <Cmp fb={fbUnformatDollars(fbFormatted)} fixed={String(parseLocaleNumber(grouped, locale))} testId='unformat' />
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function CondTab() {
  const [unit, setUnit] = useState<DistanceUnit>('kilometer');
  const [radius, setRadius] = useState(18);
  const [date, setDate] = useState('2026-10-28');
  const [time, setTime] = useState('09:30');
  const [y, m, d] = date.split('-').map(Number);
  const picked = new Date(y, (m || 1) - 1, d || 1);
  const [hh, mm] = time.split(':').map(Number);
  const secs = (hh || 0) * 3600 + (mm || 0) * 60;
  const fbDate = fbCombineDateAndTime(picked, secs);
  const fixedDate = combineDateAndTime(picked, secs);
  const show = (dt: Date) => (Number.isNaN(dt.getTime()) ? 'Invalid Date' : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${dt.toTimeString().slice(0, 5)}`);
  const verdict = (ok: boolean) => (ok ? 'cho phép' : 'chặn');
  return (
    <section>
      <p className='hint'>
        Quảng cáo nhà ở, việc làm, tín dụng: bán kính quanh một điểm phải ≥ 15 dặm hoặc ≥ 25 km. Điều kiện gốc{' '}
        <code>unit === km &amp;&amp; r &gt;= 25 || r &gt;= 15</code>.
      </p>
      <div className='toolbar'>
        <label>
          Bán kính
          <input type='number' min={1} max={80} value={radius} onChange={(e) => setRadius(+e.target.value)} data-testid='radius' />
        </label>
        <select value={unit} onChange={(e) => setUnit(e.target.value as DistanceUnit)} data-testid='unit'>
          <option value='kilometer'>km</option>
          <option value='mile'>dặm</option>
        </select>
      </div>
      <div className='stats'>
        <Stat label='bản gốc' value={<span className={fbRadiusAllowed(unit, radius) !== radiusAllowed(unit, radius) ? 'err' : ''} data-testid='radius-fb'>{verdict(fbRadiusAllowed(unit, radius))}</span>} />
        <Stat label='bản sửa' value={<span data-testid='radius-fixed'>{verdict(radiusAllowed(unit, radius))}</span>} />
        <Stat label='quy ra dặm' value={(unit === 'kilometer' ? radius / 1.609344 : radius).toFixed(1)} />
      </div>
      <div className='lb-strip' aria-hidden>
        {Array.from({ length: 30 }, (_, i) => i + 1).map((r) => {
          const fb = fbRadiusAllowed(unit, r), ok = radiusAllowed(unit, r);
          return (
            <span key={r} className={fb === ok ? (ok ? 'ok' : 'muted') : 'err'} title={`${r}`}>
              {r}
            </span>
          );
        })}
      </div>
      <p className='hint'>Ô đỏ: bản gốc cho phép nhưng đáng lẽ phải chặn.</p>
      <p className='hint'>
        Form chọn ngày + giờ. Bản gốc ghép chuỗi <code>M/D/</code> + <code>getYear()</code> rồi đưa cho <code>new Date()</code>.
      </p>
      <div className='toolbar'>
        <input type='date' value={date} onChange={(e) => setDate(e.target.value)} data-testid='date' />
        <input type='time' value={time} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className='stats'>
        <Stat label={`bản gốc (getYear() = ${(picked as Date & { getYear(): number }).getYear()})`} value={<span className={show(fbDate) === show(fixedDate) ? '' : 'err'} data-testid='date-fb'>{show(fbDate)}</span>} />
        <Stat label='bản sửa' value={<span data-testid='date-fixed'>{show(fixedDate)}</span>} />
      </div>
    </section>
  );
}

const SAMPLE = `1
00:00:01,000 --> 00:00:03,000
Xin chào

3
00:00:04,000 --> 00:00:06,000
Số thứ tự nhảy từ 1 lên 3

4
9:00:00,000 --> 10:00:00,000
Giờ một chữ số vẫn hợp lệ
`;

const ADDRESSES = ['P.O. Box 123', 'Post Office Box 9', 'Pobox', 'PO 12', '123 Polo Street', 'Pò Box 5', 'Ｐ.Ｏ. Box 7', 'Hộp thư 12, Bưu điện Hà Nội', 'Box Hill 3128'];

function TextTab() {
  const [srt, setSrt] = useState(SAMPLE);
  const [crlf, setCrlf] = useState(true);
  const [addr, setAddr] = useState('Ｐ.Ｏ. Box 7');
  const text = crlf ? srt.replace(/\r?\n/g, '\r\n') : srt.replace(/\r\n/g, '\n');
  const fb = fbValidateSrt(text);
  const fixed = validateSrt(text);
  return (
    <section>
      <p className='hint'>
        Phụ đề SRT tải lên cho video. Bản gốc tách dòng bằng <code>/r?\n/</code> (thiếu dấu <code>\</code>) và so timecode bằng chuỗi.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={crlf} onChange={(e) => setCrlf(e.target.checked)} data-testid='crlf' /> Xuống dòng kiểu Windows
          (CRLF)
        </label>
      </div>
      <textarea className='lb-srt' value={srt} onChange={(e) => setSrt(e.target.value)} rows={12} spellCheck={false} />
      <div className='stats'>
        <Stat label='bản gốc: mã lỗi' value={<span className={fb ? 'err' : 'warn'} data-testid='srt-fb'>{fb ?? 'hợp lệ'}</span>} />
        <Stat label='bản sửa: số lỗi' value={<span data-testid='srt-fixed'>{fixed.problems.length}</span>} />
        <Stat label='cue đọc được' value={fixed.cues.length} />
      </div>
      <div className='log'>
        {fixed.problems.map((p, i) => (
          <div key={i} className='err'>
            dòng {p.line}: {p.code} {p.message}
          </div>
        ))}
        {!fixed.problems.length && <div className='ok'>bản sửa: không có lỗi</div>}
      </div>
      <p className='hint'>Địa chỉ giao hàng không được là hộp thư bưu điện (PO Box).</p>
      <div className='toolbar'>
        <input className='lb-addr' value={addr} onChange={(e) => setAddr(e.target.value)} data-testid='addr' />
        <span className={isPoBox(addr) ? 'badge err' : 'badge ok'} data-testid='addr-fixed'>
          bản sửa: {isPoBox(addr) ? 'PO Box' : 'địa chỉ thường'}
        </span>
        <span className='badge muted' data-testid='addr-fb'>
          bản gốc: {fbIsPoBox(addr) ? 'PO Box' : 'địa chỉ thường'}
        </span>
      </div>
      <table className='lb-table'>
        <thead>
          <tr>
            <th>Địa chỉ</th>
            <th>Bản gốc</th>
            <th>Bản sửa</th>
          </tr>
        </thead>
        <tbody>
          {ADDRESSES.map((a) => (
            <tr key={a} onClick={() => setAddr(a)}>
              <td>{a}</td>
              <Cmp fb={fbIsPoBox(a) ? 'PO Box' : '—'} fixed={isPoBox(a) ? 'PO Box' : '—'} />
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

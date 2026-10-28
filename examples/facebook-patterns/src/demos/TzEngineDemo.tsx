import { useMemo, useState } from 'react';
import {
  ZONES,
  browserTimeZone,
  buildTzTree,
  effectiveOffsetMinutes,
  extractTransitions,
  guessZone,
  formatOffset,
  intlOffset,
  offsetAt,
  resolveDay,
  transitions,
  type DayResolver,
  type TzTree,
} from '../lib/tzEngine';
import { Stat } from './shared';
import './TzEngineDemo.css';

/**
 * Mô phỏng evalDayExpr + getActiveRules của bản gốc (không phải mã gốc): chỉ lấy "ngày trong tháng",
 * sửa tháng cho dạng ">=" khi tràn sang tháng sau, còn dạng "<=" lùi sang tháng trước thì giữ nguyên tháng.
 */
const fbStyleResolve: DayResolver = (expr, year, month) => {
  const real = resolveDay(expr, year, month);
  const m = expr.kind === '>=' && real.day < expr.day ? month + 1 : month;
  // LocalDate không kiểm tra ngày hợp lệ: "31/4" tràn thành 1/5 khi đổi ra instant
  const d = new Date(Date.UTC(year, m - 1, real.day));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
};

const ISRAEL = ZONES['Asia/Jerusalem'];
const ymd = (ms: number, offsetSec: number) => new Date(ms + offsetSec * 1000).toISOString().slice(0, 10);

function IsraelSection() {
  const rows = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => 2005 + i).map((year) => {
        const start = (resolve: DayResolver) => transitions(ISRAEL, year, year, resolve).find((t) => t.save > 0)!;
        const fb = start(fbStyleResolve);
        const fixed = start(resolveDay);
        const probe = Date.UTC(year, 3, 15, 12); // 15/4 trưa UTC
        return {
          year,
          fb: ymd(fb.at, 7200),
          fixed: ymd(fixed.at, 7200),
          fbOff: offsetAt(ISRAEL, probe, fbStyleResolve),
          fixedOff: offsetAt(ISRAEL, probe),
          intl: intlOffset('Asia/Jerusalem', probe),
        };
      }),
    [],
  );
  const wrong = rows.filter((r) => r.fb !== r.fixed).length;

  return (
    <section className='card tz-section'>
      <h2>1. Israel 2005–2012: luật "Fri&lt;=1" tháng 4</h2>
      <p className='hint'>
        Ngày bắt đầu giờ mùa hè (giờ địa phương) và offset lúc trưa 15/4, so với dữ liệu tz của trình duyệt.
      </p>
      <div className='stats'>
        <Stat label='năm tính sai ngày bắt đầu' value={<output data-testid='tz-wrong'>{wrong}</output>} />
      </div>
      <div className='tz-scroll'>
        <table className='tz-table'>
          <thead>
            <tr>
              <th>Năm</th>
              <th>Kiểu Facebook</th>
              <th>Bản viết lại</th>
              <th>15/4: FB / mới / Intl</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year} data-testid={`tz-row-${r.year}`}>
                <td>{r.year}</td>
                <td className={r.fb === r.fixed ? '' : 'err'}>{r.fb}</td>
                <td className='ok'>{r.fixed}</td>
                <td>
                  <span className={r.fbOff === r.intl ? '' : 'err'}>{formatOffset(r.fbOff)}</span> /{' '}
                  <span className={r.fixedOff === r.intl ? 'ok' : 'err'}>{formatOffset(r.fixedOff)}</span> /{' '}
                  {formatOffset(r.intl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CompareSection() {
  const [date, setDate] = useState('2026-03-29');
  const [time, setTime] = useState('01:30');
  const ms = Date.parse(`${date}T${time}:00Z`);
  const rows = Number.isNaN(ms)
    ? []
    : Object.values(ZONES).map((z) => ({ name: z.name, mine: offsetAt(z, ms), intl: intlOffset(z.name, ms) }));
  const agree = rows.filter((r) => r.mine === r.intl).length;

  return (
    <section className='card tz-section'>
      <h2>2. Engine tự viết so với Intl</h2>
      <p className='hint'>Chọn một thời điểm UTC. 29/3/2026 01:00 UTC là lúc châu Âu đổi giờ.</p>
      <div className='toolbar'>
        <input type='date' aria-label='Ngày (UTC)' value={date} onChange={(e) => setDate(e.target.value)} />
        <input type='time' aria-label='Giờ (UTC)' value={time} onChange={(e) => setTime(e.target.value)} />
        <span className='hint'>UTC</span>
      </div>
      <div className='stats'>
        <Stat label='múi giờ khớp Intl' value={<output data-testid='tz-agree'>{`${agree}/${rows.length}`}</output>} />
      </div>
      <div className='tz-scroll'>
        <table className='tz-table'>
          <thead>
            <tr>
              <th>Múi giờ</th>
              <th>Engine</th>
              <th>Intl</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={r.mine === r.intl ? 'ok' : 'err'}>{formatOffset(r.mine)}</td>
                <td>{formatOffset(r.intl)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const OFFSETS = [-480, -300, 0, 60, 420, 540, 780];

function SkewSection() {
  const [browser, setBrowser] = useState(0);
  const [skewMin, setSkewMin] = useState(420);
  const [stored, setStored] = useState(420);
  const now = Date.now();
  const effective = effectiveOffsetMinutes(now, now + skewMin * 60_000, browser);
  const sends = effective !== stored;
  const fmtMin = (m: number) => formatOffset(m * 60);

  return (
    <section className='card tz-section'>
      <h2>3. Đồng hồ máy bị chỉnh tay</h2>
      <p className='hint'>
        Trình duyệt của bạn báo múi <code>{browserTimeZone() ?? 'không rõ'}</code>, offset{' '}
        {fmtMin(-new Date().getTimezoneOffset())}. Giả lập một máy để múi khác nhưng chỉnh kim đồng hồ cho "đúng giờ".
      </p>
      <div className='tz-form'>
        <label>
          Múi máy đang để
          <select value={browser} onChange={(e) => setBrowser(+e.target.value)}>
            {OFFSETS.map((o) => (
              <option key={o} value={o}>
                {fmtMin(o)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Đồng hồ nhanh hơn server (phút)
          <input type='number' step={1} value={skewMin} onChange={(e) => setSkewMin(+e.target.value || 0)} />
        </label>
        <label>
          Offset server đang lưu
          <select value={stored} onChange={(e) => setStored(+e.target.value)}>
            {OFFSETS.map((o) => (
              <option key={o} value={o}>
                {fmtMin(o)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className='stats'>
        <Stat label='offset trình duyệt báo' value={<output>{fmtMin(browser)}</output>} />
        <Stat label='offset thật (đã trừ lệch)' value={<output data-testid='tz-effective'>{fmtMin(effective)}</output>} />
        <Stat label='gửi cập nhật lên server?' value={<output data-testid='tz-send'>{sends ? 'có' : 'không'}</output>} />
      </div>
    </section>
  );
}

// offset (giây) của chính trình duyệt, chỉ dùng Date như bản gốc
const envProbe = (ms: number) => -new Date(ms).getTimezoneOffset() * 60;

function GuessSection() {
  const [result, setResult] = useState<null | {
    zones: string[];
    questions: number;
    total: number;
    buildMs: number;
    transitions: string[];
  }>(null);

  const run = () => {
    const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : Object.keys(ZONES);
    const probes: number[] = [];
    for (let y = 2020; y <= 2027; y++) for (let m = 0; m < 12; m++) probes.push(Date.UTC(y, m, 1), Date.UTC(y, m, 15));
    const t0 = performance.now();
    const tree: TzTree = buildTzTree(zones, probes, intlOffset);
    const buildMs = Math.round(performance.now() - t0);
    const year = new Date().getUTCFullYear();
    const transitions = extractTransitions(envProbe, Date.UTC(year, 0, 1), Date.UTC(year + 1, 0, 1)).map(
      (t) => `${new Date(t.at).toISOString().slice(0, 16).replace('T', ' ')} UTC → ${formatOffset(t.offset)}`,
    );
    setResult({ ...guessZone(tree, envProbe), total: zones.length, buildMs, transitions });
  };

  return (
    <section className='card tz-section'>
      <h2>4. Đoán múi giờ chỉ bằng getTimezoneOffset</h2>
      <p className='hint'>
        Dựng cây quyết định từ dữ liệu Intl (offset ngày 1 và 15 mỗi tháng, 2020–2027), rồi đi cây bằng{' '}
        <code>Date.getTimezoneOffset()</code> của trình duyệt. Mỗi nút là một câu hỏi "offset lúc t là bao nhiêu?".
      </p>
      <div className='toolbar'>
        <button className='primary' data-testid='tz-guess' onClick={run}>
          Dựng cây và đoán
        </button>
      </div>
      {result && (
        <>
          <div className='stats'>
            <Stat label='câu hỏi đã dùng' value={<output data-testid='tz-questions'>{result.questions}</output>} />
            <Stat
              label='múi giờ trong nhóm cuối'
              value={<output data-testid='tz-group'>{`${result.zones.length}/${result.total}`}</output>}
            />
            <Stat label='ms dựng cây' value={<output>{result.buildMs}</output>} />
          </div>
          <div className='tz-rows'>
            <div>
              <b>Nhóm đoán được:</b> {result.zones.slice(0, 12).join(', ')}
              {result.zones.length > 12 ? ', …' : ''}
            </div>
            <div>
              <b>Intl báo:</b> {browserTimeZone() ?? 'không rõ'}
            </div>
            <div>
              <b>Lần đổi giờ năm nay (dò bằng Date + tìm nhị phân):</b>{' '}
              <output data-testid='tz-extract'>{result.transitions.join('; ') || 'không có'}</output>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default function TzEngineDemo() {
  return (
    <div className='page tz-demo'>
      <h1>Engine múi giờ trên client</h1>
      <IsraelSection />
      <CompareSection />
      <SkewSection />
      <GuessSection />
    </div>
  );
}

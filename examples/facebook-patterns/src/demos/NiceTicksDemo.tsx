import { useState } from 'react';
import { numericTicks, timeTicks, type TimeTicks } from '../lib/niceTicks';
import { Stat } from './shared';
import './NiceTicksDemo.css';

export default function NiceTicksDemo() {
  return (
    <div className='page nt-demo'>
      <h1>Vạch trục &quot;đẹp&quot; cho biểu đồ</h1>
      <p className='hint'>
        Chia đều [min, max] cho ra vạch lẻ như 17.2, 30.7, 44.2…; làm tròn bước về {'{1, 2, 5}'} × 10<sup>k</sup> thì ra
        10, 20, 30. Trục thời gian chọn bước trong một bảng cố định rồi căn vạch theo lịch.
      </p>
      <NumericSection />
      <TimeSection />
    </div>
  );
}

function NumericSection() {
  const [min, setMin] = useState('3.7');
  const [max, setMax] = useState('71.2');
  const [count, setCount] = useState(5);

  const lo = Number(min);
  const hi = Number(max);
  const valid = Number.isFinite(lo) && Number.isFinite(hi);
  const nice = valid ? numericTicks(lo, hi, count) : null;
  const naive = valid
    ? Array.from({ length: count + 1 }, (_, i) => Math.min(lo, hi) + (i * Math.abs(hi - lo)) / count)
    : [];

  return (
    <section className='card nt-card'>
      <h2>1. Trục số</h2>
      <div className='toolbar'>
        <label>
          min <input value={min} onChange={(e) => setMin(e.target.value)} size={8} data-testid='nt-min' />
        </label>
        <label>
          max <input value={max} onChange={(e) => setMax(e.target.value)} size={8} data-testid='nt-max' />
        </label>
        <label>
          số khoảng ~{count}{' '}
          <input type='range' min={2} max={12} value={count} onChange={(e) => setCount(Number(e.target.value))} />
        </label>
      </div>
      <div className='toolbar'>
        {[
          ['3.7', '71.2'],
          ['0', '0.0037'],
          ['-48', '1210'],
          ['0.1', '0.3'],
          ['5', '5'],
        ].map(([a, b]) => (
          <button key={a + b} onClick={() => (setMin(a), setMax(b))}>
            [{a}, {b}]
          </button>
        ))}
      </div>
      {!valid && <p className='err'>min/max phải là số.</p>}
      {nice && (
        <>
          <Axis label='Chia đều' ticks={naive} from={naive[0]} to={naive[naive.length - 1]} format={(v) => String(+v.toPrecision(15))} />
          <Axis label='Bước đẹp' ticks={nice.ticks} from={nice.start} to={nice.end} format={String} testid='nt-nice' />
          <div className='stats'>
            <Stat label='bước' value={<output data-testid='nt-step'>{nice.step}</output>} />
            <Stat label='miền mở rộng' value={`[${nice.start}, ${nice.end}]`} />
            <Stat label='số vạch' value={nice.ticks.length} />
          </div>
        </>
      )}
    </section>
  );
}

function Axis({
  label,
  ticks,
  from,
  to,
  format,
  testid,
}: {
  label: string;
  ticks: number[];
  from: number;
  to: number;
  format: (v: number) => string;
  testid?: string;
}) {
  const span = to - from || 1;
  return (
    <div className='nt-axis' data-testid={testid}>
      <div className='nt-axis-label'>{label}</div>
      <div className='nt-track'>
        {ticks.map((t, i) => (
          <span key={i} className='nt-tick' style={{ left: `${((t - from) / span) * 100}%` }}>
            <i />
            <bdi>{format(t)}</bdi>
          </span>
        ))}
      </div>
    </div>
  );
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const PRESETS: Array<[string, number]> = [
  ['400ms', 400],
  ['90 giây', 90 * SEC],
  ['50 phút', 50 * MIN],
  ['6 giờ', 6 * HOUR],
  ['10 ngày', 10 * DAY],
  ['2 tháng', 61 * DAY],
  ['9 tháng', 270 * DAY],
  ['30 năm', 30 * 365 * DAY],
];

const UNIT_NAMES: Record<TimeTicks['unit'], string> = {
  year: 'năm',
  month: 'tháng',
  week: 'tuần',
  day: 'ngày',
  hour: 'giờ',
  minute: 'phút',
  second: 'giây',
  ms: 'ms',
};

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatTick(t: number, unit: TimeTicks['unit']) {
  const d = new Date(t);
  const date = `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  switch (unit) {
    case 'year':
      return String(d.getUTCFullYear());
    case 'month':
      return d.getUTCMonth() === 0 ? String(d.getUTCFullYear()) : `T${d.getUTCMonth() + 1}`;
    case 'week':
    case 'day':
      return date;
    case 'hour':
    case 'minute':
      return time;
    case 'second':
      return `${time}:${pad(d.getUTCSeconds())}`;
    default:
      return `${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  }
}

function TimeSection() {
  const [span, setSpan] = useState(PRESETS[3][1]);
  // mốc lệch giờ "lẻ" để thấy việc căn theo lịch
  const from = Date.UTC(2026, 9, 28, 9, 47, 13, 250);
  const to = from + span;
  // màn hình hẹp thì xin ít vạch hơn để nhãn không đè nhau
  const narrow = typeof window !== 'undefined' && window.matchMedia('(max-width: 480px)').matches;
  const result = timeTicks(from, to, narrow ? 4 : 6);

  return (
    <section className='card nt-card'>
      <h2>2. Trục thời gian (UTC)</h2>
      <div className='toolbar'>
        {PRESETS.map(([name, ms]) => (
          <button key={name} className={ms === span ? 'primary' : ''} onClick={() => setSpan(ms)}>
            {name}
          </button>
        ))}
      </div>
      <p className='hint'>
        Từ {new Date(from).toISOString().replace('T', ' ').slice(0, 23)} tới{' '}
        {new Date(to).toISOString().replace('T', ' ').slice(0, 23)}
      </p>
      <Axis label='Vạch' ticks={result.ticks} from={from} to={to} format={(t) => formatTick(t, result.unit)} testid='nt-time' />
      <div className='stats'>
        <Stat label='bước' value={<output data-testid='nt-unit'>{`${result.count} ${UNIT_NAMES[result.unit]}`}</output>} />
        <Stat label='số vạch' value={result.ticks.length} />
      </div>
      {span < SEC && (
        <p className='hint warn'>
          Bản gốc (CandelaScalingStrategyTime) ném invariant khi bước nhỏ hơn 1 giây; bản viết lại chuyển sang bước
          {' {1, 2, 5}'} × 10<sup>k</sup> mili-giây.
        </p>
      )}
    </section>
  );
}

import { useMemo, useRef, useState } from 'react';
import { MovingStat } from '../lib/movingStat';
import { Interval, mergeIntervals, naivePeriod, toPeriod, type Period } from '../lib/timeInterval';
import { Stat } from './shared';
import './MovingStatDemo.css';

/**
 * Mô phỏng hành vi MovingStat gốc (không phải mã gốc): bucket đầu được bỏ khi `start < cutoff`
 * VÀ còn bucket sau nó, nên bucket cuối không bao giờ bị bỏ; trung bình chia cho cả cửa sổ.
 */
class FbStyleMovingStat {
  sum = 0;
  count = 0;
  private head: { t: number; v: number; count: number; next?: FbStyleMovingStat['head'] };
  private tail: FbStyleMovingStat['head'];
  constructor(
    private windowMs: number,
    private now: () => number,
  ) {
    this.head = this.tail = { t: now(), v: 0, count: 0 };
  }
  add(v: number) {
    this.sum += v;
    this.count++;
    const t = this.now();
    if (t - this.tail.t < 1000) {
      this.tail.v += v;
      this.tail.count++;
      return;
    }
    this.tail = this.tail.next = { t, v, count: 1 };
    this.evict();
  }
  tally(per = 1000) {
    this.evict();
    return { sum: this.sum, count: this.count, ratePer: (this.sum * per) / this.windowMs };
  }
  private evict() {
    const cutoff = this.now() - this.windowMs;
    while (this.head.next && this.head.t < cutoff) {
      this.sum -= this.head.v;
      this.count -= this.head.count;
      this.head = this.head.next;
    }
  }
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

function MovingSection() {
  const clock = useRef(0);
  const make = () => {
    const now = () => clock.current;
    return { fb: new FbStyleMovingStat(60_000, now), fixed: new MovingStat({ now }) };
  };
  const stats = useRef(make());
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);

  const fb = stats.current.fb.tally();
  const fixed = stats.current.fixed.tally();

  return (
    <section className='card ms-section'>
      <h2>1. Đếm sự kiện trong 60 giây gần nhất</h2>
      <p className='hint'>
        Đồng hồ giả, tua tay được. Bắn 30 sự kiện trong 3 giây, đọc tốc độ ngay, rồi tua 61 giây không có gì xảy ra.
      </p>
      <div className='toolbar'>
        <button
          className='primary'
          data-testid='ms-burst'
          onClick={() => {
            for (let i = 0; i < 30; i++) {
              stats.current.fb.add(1);
              stats.current.fixed.add(1);
              clock.current += 100;
            }
            rerender();
          }}
        >
          Bắn 30 sự kiện (3 giây)
        </button>
        <button
          data-testid='ms-idle'
          onClick={() => {
            clock.current += 61_000;
            rerender();
          }}
        >
          Tua 61 giây im lặng
        </button>
        <button
          onClick={() => {
            clock.current = 0;
            stats.current = make();
            rerender();
          }}
        >
          Làm lại
        </button>
      </div>
      <p className='hint'>
        Đồng hồ: <output data-testid='ms-clock'>{(clock.current / 1000).toFixed(1)}</output> giây
      </p>
      <div className='ms-compare'>
        <div>
          <h3>Kiểu Facebook</h3>
          <div className='stats'>
            <Stat label='tổng trong cửa sổ' value={<output data-testid='ms-fb-sum'>{fb.sum}</output>} />
            <Stat label='sự kiện/giây' value={<output data-testid='ms-fb-rate'>{fmt(fb.ratePer)}</output>} />
          </div>
        </div>
        <div>
          <h3>Bản viết lại</h3>
          <div className='stats'>
            <Stat label='tổng trong cửa sổ' value={<output data-testid='ms-fixed-sum'>{fixed.sum}</output>} />
            <Stat label='sự kiện/giây' value={<output data-testid='ms-fixed-rate'>{fmt(fixed.ratePer)}</output>} />
          </div>
        </div>
      </div>
    </section>
  );
}

const showPeriod = (p: Period) => `${p.years} năm ${p.months} tháng ${p.days} ngày`;
const PRESETS: [string, string][] = [
  ['2026-01-31', '2026-03-01'],
  ['2024-02-29', '2025-02-28'],
  ['2025-08-31', '2026-02-28'],
  ['2000-05-15', '2026-10-28'],
];

function PeriodSection() {
  const [from, setFrom] = useState(PRESETS[0][0]);
  const [to, setTo] = useState(PRESETS[0][1]);
  const result = useMemo(() => {
    const a = Date.parse(from);
    const b = Date.parse(to);
    if (Number.isNaN(a) || Number.isNaN(b) || a > b) return null;
    const iv = Interval.of(a, b);
    return { cal: showPeriod(toPeriod(iv)), naive: showPeriod(naivePeriod(iv)) };
  }, [from, to]);

  return (
    <section className='card ms-section'>
      <h2>2. "Bao lâu rồi?" theo lịch</h2>
      <p className='hint'>Đếm tháng trọn bằng cách cộng tháng từ mốc đầu, so với cách chia 30 ngày.</p>
      <div className='toolbar'>
        <input type='date' aria-label='Từ ngày' value={from} onChange={(e) => setFrom(e.target.value)} />
        <span>→</span>
        <input type='date' aria-label='Đến ngày' value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <div className='toolbar'>
        {PRESETS.map(([a, b]) => (
          <button
            key={a + b}
            onClick={() => {
              setFrom(a);
              setTo(b);
            }}
          >
            {a} → {b}
          </button>
        ))}
      </div>
      {result ? (
        <div className='stats'>
          <Stat label='theo lịch' value={<output data-testid='ms-cal'>{result.cal}</output>} />
          <Stat label='chia 30 ngày' value={<output data-testid='ms-naive'>{result.naive}</output>} />
        </div>
      ) : (
        <p className='hint'>Ngày đầu phải trước ngày cuối.</p>
      )}
    </section>
  );
}

const H = 3_600_000;
const BOOKINGS = [
  Interval.of(9 * H, 10 * H),
  Interval.of(10 * H, 11 * H),
  Interval.of(13 * H, 14.5 * H),
  Interval.of(14 * H, 15 * H),
  Interval.of(16 * H, 16.5 * H),
];
const hh = (t: number) => `${Math.floor(t / H)}:${String(Math.round((t % H) / 60_000)).padStart(2, '0')}`;

function MergeSection() {
  const merged = mergeIntervals(BOOKINGS);
  const gaps = merged.slice(1).map((iv, i) => merged[i].gap(iv)).filter((g): g is Interval => g !== null);
  return (
    <section className='card ms-section'>
      <h2>3. Gộp lịch bận, tìm giờ trống</h2>
      <p className='hint'>
        Khoảng nửa mở [đầu, cuối): 9:00–10:00 và 10:00–11:00 chỉ dính mép, không chồng nhau, nhưng vẫn gộp được.
      </p>
      <div className='ms-rows'>
        <div>
          <b>Đặt lịch:</b> {BOOKINGS.map((b) => `${hh(b.start)}–${hh(b.end)}`).join(', ')}
        </div>
        <div>
          <b>Sau khi gộp:</b>{' '}
          <output data-testid='ms-merged'>{merged.map((b) => `${hh(b.start)}–${hh(b.end)}`).join(', ')}</output>
        </div>
        <div>
          <b>Giờ trống:</b> {gaps.map((b) => `${hh(b.start)}–${hh(b.end)}`).join(', ')}
        </div>
      </div>
    </section>
  );
}

export default function MovingStatDemo() {
  return (
    <div className='page ms-demo'>
      <h1>Cửa sổ trượt và khoảng thời gian</h1>
      <MovingSection />
      <PeriodSection />
      <MergeSection />
    </div>
  );
}

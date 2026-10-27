import { useMemo, useState } from 'react';
import {
  calendarDaysBetween,
  findTransitions,
  formatOffset,
  formatWall,
  fromWallTime,
  getOffset,
  getPacificDSTRange,
  resolveWallTime,
  slotToInstant,
  toWallTime,
  type Disambiguation,
  type SlotStrategy,
} from '../lib/dst';
import './DstDemo.css';

const ZONES = [
  { id: 'America/Los_Angeles', label: 'Los Angeles (Pacific)' },
  { id: 'Europe/Berlin', label: 'Berlin' },
  { id: 'Australia/Sydney', label: 'Sydney (đổi giờ ngược mùa)' },
  { id: 'America/Santiago', label: 'Santiago (đổi giờ lúc 00:00)' },
  { id: 'Asia/Ho_Chi_Minh', label: 'TP.HCM (không có DST)' },
];

const STRATEGIES: { id: SlotStrategy; label: string }[] = [
  { id: 'duration', label: 'Cộng phút (moment.add)' },
  { id: 'compensate', label: 'Cộng phút + bù offset (Pipedrive)' },
  { id: 'wallclock', label: 'Đặt giờ treo tường (bản viết lại)' },
];

/** Bản chép luật của Udemy: chỉ có luật từ 2007, áp cho mọi năm (để so sánh). */
function udemyRange(year: number) {
  const isSunday = (date: Date) => date.getUTCDay() === 0;
  const days = (n: number, month: number, hour: number) =>
    Array.from({ length: n }, (_, i) => new Date(Date.UTC(year, month, i + 1, hour)));
  return [days(14, 2, 10).filter(isSunday)[1], days(7, 10, 9).filter(isSunday)[0]];
}

const pad = (n: number) => String(n).padStart(2, '0');
const hostZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const temporal = (globalThis as { Temporal?: any }).Temporal;

export default function DstDemo() {
  const [zone, setZone] = useState(ZONES[0].id);
  const [year] = useState(2026);
  const transitions = useMemo(() => findTransitions(zone, year), [zone, year]);
  const [which, setWhich] = useState(0);
  const transition = transitions[Math.min(which, transitions.length - 1)];

  // Ngày (giờ địa phương) chứa mốc đổi giờ đang chọn; không có DST thì lấy 8/3
  const day = transition
    ? (() => {
        const w = toWallTime(transition.instant, zone);
        return { year: w.year, month: w.month, day: w.day };
      })()
    : { year, month: 3, day: 8 };

  const rows = Array.from({ length: 24 }, (_, hour) => {
    const kind = resolveWallTime({ ...day, hour, minute: 0 }, zone).kind;
    return {
      hour,
      kind,
      results: STRATEGIES.map((s) => {
        const instant = slotToInstant(day, hour * 60, zone, s.id);
        const wall = toWallTime(instant, zone);
        // Ô thuộc giờ không tồn tại: đẩy sang giờ kế tiếp là chấp nhận được, không tính là sai
        const ok = wall.day === day.day && (wall.hour === hour || (kind === 'gap' && wall.hour > hour));
        return { text: formatWall(instant, zone), ok };
      }),
    };
  });

  return (
    <div className='page dst-demo'>
      <h1>Giờ mùa hè không cần thư viện</h1>
      <p className='hint'>
        Mỗi hàng là một ô trên lịch tuần (y = giờ × chiều cao một giờ). Ba cột là ba cách đổi ô đó ra thời
        điểm. Ô đỏ: lịch đặt sự kiện sai giờ. Máy bạn đang ở <code>{hostZone}</code>, kết quả không phụ thuộc
        vào đó.
      </p>

      <div className='toolbar'>
        <label>
          Múi giờ{' '}
          <select value={zone} onChange={(e) => (setZone(e.target.value), setWhich(0))}>
            {ZONES.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
        {transitions.map((t, i) => (
          <button key={t.instant} className={i === which ? 'primary' : ''} onClick={() => setWhich(i)}>
            {t.offsetAfter > t.offsetBefore ? 'Tiến đồng hồ' : 'Lùi đồng hồ'} ngày {formatWall(t.instant, zone, true).slice(0, 5)}
          </button>
        ))}
      </div>

      <div className='stats'>
        <div className='stat'>
          <b>
            {pad(day.day)}/{pad(day.month)}/{day.year}
          </b>
          <span>ngày đang xem</span>
        </div>
        <div className='stat'>
          <b>{transition ? `${formatOffset(transition.offsetBefore)} → ${formatOffset(transition.offsetAfter)}` : formatOffset(getOffset(zone, Date.now()))}</b>
          <span>{transition ? 'offset trước → sau' : 'năm nay không đổi giờ'}</span>
        </div>
        <div className='stat'>
          <b>{STRATEGIES.map((_, i) => rows.filter((r) => !r.results[i].ok).length).join(' / ')}</b>
          <span>ô sai: cộng phút / bù offset / giờ treo tường</span>
        </div>
      </div>

      <div className='dst-table' role='table' aria-label='Ô lịch và thời điểm tính ra'>
        <div className='dst-row dst-head' role='row'>
          <span role='columnheader'>Ô</span>
          {STRATEGIES.map((s) => (
            <span key={s.id} role='columnheader'>
              {s.label}
            </span>
          ))}
        </div>
        {rows.map((row) => (
          <div key={row.hour} className={`dst-row ${row.kind}`} role='row'>
            <span role='rowheader'>
              {pad(row.hour)}:00
              {row.kind === 'gap' && <small> không tồn tại</small>}
              {row.kind === 'overlap' && <small> có 2 lần</small>}
            </span>
            {row.results.map((r, i) => (
              <span key={i} className={r.ok ? '' : 'bad'} role='cell'>
                {r.text}
              </span>
            ))}
          </div>
        ))}
      </div>

      <AmbiguousTime zone={zone} transitions={transitions} />
      <CouponDays />
      <RuleVsIntl />
    </div>
  );
}

function AmbiguousTime({ zone, transitions }: { zone: string; transitions: ReturnType<typeof findTransitions> }) {
  const [mode, setMode] = useState<Disambiguation>('compatible');
  if (transitions.length === 0) return null;
  const cases = transitions.map((t) => {
    // Giờ treo tường nằm giữa vùng gap/overlap: lấy giờ địa phương ngay trước mốc + nửa độ chênh
    const before = toWallTime(t.instant - 60_000, zone);
    const delta = Math.abs(t.offsetAfter - t.offsetBefore);
    const gap = t.offsetAfter > t.offsetBefore;
    const base = Date.UTC(before.year, before.month - 1, before.day, before.hour, before.minute) + 60_000;
    const mid = new Date(base + (gap ? delta / 2 : -delta / 2) * 60_000);
    const wall = {
      year: mid.getUTCFullYear(),
      month: mid.getUTCMonth() + 1,
      day: mid.getUTCDate(),
      hour: mid.getUTCHours(),
      minute: mid.getUTCMinutes(),
    };
    let result: string;
    try {
      const instant = fromWallTime(wall, zone, mode);
      result = `${formatWall(instant, zone)} (${formatOffset(getOffset(zone, instant))}) = ${new Date(instant).toISOString().slice(0, 16)}Z`;
    } catch (error) {
      result = (error as Error).message;
    }
    let viaTemporal = '';
    if (temporal) {
      try {
        const zdt = temporal.ZonedDateTime.from({ timeZone: zone, ...wall }, { disambiguation: mode });
        viaTemporal = `${zdt.toPlainTime().toString().slice(0, 5)} (${zdt.offset})`;
      } catch (error) {
        viaTemporal = 'RangeError';
      }
    }
    return { gap, wall, result, viaTemporal };
  });

  return (
    <section className='card dst-section'>
      <h2>Giờ không tồn tại và giờ có hai lần</h2>
      <div className='toolbar' role='radiogroup' aria-label='disambiguation'>
        {(['compatible', 'earlier', 'later', 'reject'] as Disambiguation[]).map((m) => (
          <label key={m} className='switch'>
            <input type='radio' name='dis' checked={mode === m} onChange={() => setMode(m)} /> {m}
          </label>
        ))}
      </div>
      <ul>
        {cases.map((c) => (
          <li key={c.gap ? 'gap' : 'overlap'}>
            <b>
              {pad(c.wall.hour)}:{pad(c.wall.minute)}
            </b>{' '}
            ngày {pad(c.wall.day)}/{pad(c.wall.month)} ({c.gap ? 'gap: đồng hồ nhảy qua' : 'overlap: đồng hồ đi qua hai lần'}) →{' '}
            <code>{c.result}</code>
            {temporal && (
              <>
                {' '}
                · Temporal: <code>{c.viaTemporal}</code>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className='muted'>
        {temporal
          ? 'Trình duyệt này có Temporal: cột bên phải tính bằng Temporal.ZonedDateTime để đối chiếu.'
          : 'Trình duyệt này chưa có Temporal, chỉ hiện kết quả của dst.ts.'}
      </p>
    </section>
  );
}

function CouponDays() {
  const [start, setStart] = useState('2026-03-01');
  const [end, setEnd] = useState('2026-03-31');
  const parse = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return { year: y, month: m, day: d };
  };
  const a = parse(start);
  const b = parse(end);
  const zone = 'America/Los_Angeles';
  const startInstant = fromWallTime({ ...a, hour: 0, minute: 0 }, zone);
  const endInstant = fromWallTime({ ...b, hour: 0, minute: 0 }, zone);
  const naive = Math.floor((endInstant - startInstant) / 86_400_000);
  const days = calendarDaysBetween(a, b);

  return (
    <section className='card dst-section'>
      <h2>Coupon kéo dài mấy ngày? (Udemy)</h2>
      <div className='toolbar'>
        <label>
          Từ 00:00 PT <input type='date' value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </label>
        <label>
          đến 00:00 PT <input type='date' value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </label>
      </div>
      <div className='stats'>
        <div className='stat'>
          <b className={naive !== days ? 'err' : ''}>{naive}</b>
          <span>floor(ms / 86 400 000)</span>
        </div>
        <div className='stat'>
          <b className='ok'>{days}</b>
          <span>ngày lịch (Date.UTC)</span>
        </div>
      </div>
    </section>
  );
}

function RuleVsIntl() {
  const years = [2005, 2006, 2007, 2026];
  const zone = 'America/Los_Angeles';
  const fmt = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
  return (
    <section className='card dst-section'>
      <h2>Tự viết luật hay hỏi Intl?</h2>
      <div className='dst-rules' role='table' aria-label='Mốc đổi giờ Pacific'>
        <div className='dst-rule dst-head' role='row'>
          <span>Năm</span>
          <span>Luật của Udemy</span>
          <span>dst.ts (có luật cũ)</span>
          <span>Intl</span>
        </div>
        {years.map((y) => {
          const intl = findTransitions(zone, y).map((t) => fmt(new Date(t.instant))).join(' → ');
          const udemy = udemyRange(y).map(fmt).join(' → ');
          const ours = getPacificDSTRange(y).map(fmt).join(' → ');
          return (
            <div key={y} className='dst-rule' role='row'>
              <span>{y}</span>
              <span className={udemy === intl ? '' : 'bad'}>{udemy}</span>
              <span className={ours === intl ? '' : 'bad'}>{ours}</span>
              <span>{intl}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

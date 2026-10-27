import { useEffect, useState } from 'react';
import {
  bracketsForDay,
  complement,
  dayLabel,
  fbStyleDayLabel,
  fbStyleIsInBrackets,
  formatSecond,
  getOpenStatus,
  isInBrackets,
  parseHHMM,
  SECONDS_IN_DAY,
  wallClockAfterAddingSeconds,
  zonedMidnight,
  zonedNow,
  type WeeklyRange,
} from '../lib/weeklyHours';
import { Stat } from './shared';
import './WeeklyHoursDemo.css';

const DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const ALL = [0, 1, 2, 3, 4, 5, 6];

const PRESETS: Record<string, WeeklyRange[]> = {
  'Quán cà phê 07:00–22:00': [{ id: 'cf', weekdays: ALL, fromSec: parseHHMM('07:00'), toSec: parseHHMM('22:00') }],
  'Quán bar, cuối tuần mở qua đêm': [
    { id: 'wk', weekdays: [1, 2, 3, 4], fromSec: parseHHMM('18:00'), toSec: parseHHMM('23:00') },
    { id: 'we', weekdays: [5, 6], fromSec: parseHHMM('18:00'), toSec: parseHHMM('02:00') },
  ],
  'Nhà hàng nghỉ trưa (khoảng chồng nhau)': [
    { id: 'am', weekdays: [1, 2, 3, 4, 5, 6], fromSec: parseHHMM('10:00'), toSec: parseHHMM('14:00') },
    { id: 'pm', weekdays: [1, 2, 3, 4, 5, 6], fromSec: parseHHMM('17:00'), toSec: parseHHMM('22:00') },
    { id: 'late', weekdays: [5, 6], fromSec: parseHHMM('21:00'), toSec: parseHHMM('23:30') },
  ],
};

const ZONES = ['Asia/Ho_Chi_Minh', 'America/New_York', 'Europe/Berlin'];

let nextId = 0;

export default function WeeklyHoursDemo() {
  const [ranges, setRanges] = useState<WeeklyRange[]>(PRESETS['Quán bar, cuối tuần mở qua đêm']);
  const [zone, setZone] = useState(ZONES[0]);
  const [live, setLive] = useState(false);
  const [weekday, setWeekday] = useState(5);
  const [second, setSecond] = useState(parseHHMM('23:30'));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [live]);

  const now = live ? zonedNow(new Date(), zone) : { weekday, secondOfDay: second, date: '' };
  void tick;
  const status = getOpenStatus(now, ranges);

  const update = (id: string, patch: Partial<WeeklyRange>) =>
    setRanges((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // ---- ba lỗi của bản gốc, tính trên dữ liệu thật của demo ----
  const cafe = bracketsForDay(2, PRESETS['Quán cà phê 07:00–22:00']);
  const atOpen = parseHHMM('07:00');
  const nyMidnight = zonedMidnight('2026-03-08', 'America/New_York');

  return (
    <div className='page wh'>
      <h1>Giờ mở cửa theo tuần</h1>
      <p className='hint'>
        Mỗi dòng là một khoảng giờ áp cho các ngày đã chọn. "Từ" lớn hơn "đến" là khoảng qua đêm: phần sau nửa đêm tự
        chuyển sang ngày hôm sau. Các khoảng chồng nhau được gộp lại trước khi vẽ.
      </p>

      <div className='toolbar'>
        {Object.keys(PRESETS).map((name) => (
          <button key={name} onClick={() => setRanges(PRESETS[name].map((r) => ({ ...r })))}>
            {name}
          </button>
        ))}
      </div>

      <div className='wh-editor'>
        {ranges.map((r) => (
          <div key={r.id} className='wh-range card'>
            <div className='wh-days' role='group' aria-label='Ngày áp dụng'>
              {ALL.map((d) => (
                <label key={d} data-on={r.weekdays.includes(d) || undefined}>
                  <input
                    type='checkbox'
                    checked={r.weekdays.includes(d)}
                    onChange={(e) =>
                      update(r.id, {
                        weekdays: e.target.checked ? [...r.weekdays, d].sort() : r.weekdays.filter((x) => x !== d),
                      })
                    }
                  />
                  {DAYS[d]}
                </label>
              ))}
            </div>
            <label>
              Từ <input type='time' value={formatSecond(r.fromSec)} onChange={(e) => update(r.id, { fromSec: parseHHMM(e.target.value) })} />
            </label>
            <label>
              đến <input type='time' value={formatSecond(r.toSec)} onChange={(e) => update(r.id, { toSec: parseHHMM(e.target.value) })} />
            </label>
            {r.fromSec >= r.toSec && <span className='badge warn'>qua đêm</span>}
            <button onClick={() => setRanges((rs) => rs.filter((x) => x.id !== r.id))} aria-label='Xoá khoảng'>
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setRanges((rs) => [...rs, { id: `n${nextId++}`, weekdays: [1, 2, 3, 4, 5], fromSec: parseHHMM('09:00'), toSec: parseHHMM('17:00') }])
          }
        >
          + Thêm khoảng
        </button>
      </div>

      <h2>Tuần nhìn theo từng ngày</h2>
      <div className='wh-week'>
        {ALL.map((d) => {
          const open = bracketsForDay(d, ranges);
          return (
            <div key={d} className='wh-day' data-today={d === now.weekday || undefined}>
              <b>{DAYS[d]}</b>
              <div className='wh-bar' aria-label={`${DAYS[d]}: ${open.map((b) => `${formatSecond(b.from)}–${formatSecond(b.to)}`).join(', ') || 'đóng cả ngày'}`}>
                {open.map((b) => (
                  <span
                    key={b.from}
                    className='wh-open'
                    style={{ insetInlineStart: `${(b.from / SECONDS_IN_DAY) * 100}%`, width: `${((b.to - b.from) / SECONDS_IN_DAY) * 100}%` }}
                    title={`${formatSecond(b.from)}–${formatSecond(b.to)}`}
                  />
                ))}
                {d === now.weekday && <span className='wh-now' style={{ insetInlineStart: `${(now.secondOfDay / SECONDS_IN_DAY) * 100}%` }} />}
              </div>
              <small className='muted'>
                đóng: {complement(open).map((b) => `${formatSecond(b.from)}–${formatSecond(b.to)}`).join(', ')}
              </small>
            </div>
          );
        })}
      </div>

      <h2>Bây giờ cửa hàng có mở không?</h2>
      <div className='toolbar'>
        <label>
          Múi giờ cửa hàng{' '}
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            {ZONES.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label>
          <input type='checkbox' checked={live} onChange={(e) => setLive(e.target.checked)} /> dùng giờ thật
        </label>
        {!live && (
          <>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} aria-label='Thứ'>
              {ALL.map((d) => (
                <option key={d} value={d}>
                  {DAYS[d]}
                </option>
              ))}
            </select>
            <input
              type='time'
              step={1}
              value={`${formatSecond(second)}:${String(second % 60).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m, s = '0'] = e.target.value.split(':');
                setSecond(Number(h) * 3600 + Number(m) * 60 + Number(s));
              }}
              aria-label='Giờ'
            />
          </>
        )}
      </div>
      <div className='stats'>
        <Stat label='trạng thái' value={<bdi className={status.open ? 'ok' : 'err'}>{status.open ? 'Đang mở' : 'Đang đóng'}</bdi>} />
        <Stat
          label={status.open ? 'đóng lúc' : 'mở lại lúc'}
          value={<bdi>{status.next ? `${formatSecond(status.next.secondOfDay)} ${dayLabel(status.next.inDays, status.next.weekday)}` : '—'}</bdi>}
        />
        <Stat label={`giờ tại ${zone.split('/')[1].replace('_', ' ')}`} value={<bdi>{`${DAYS[now.weekday]} ${formatSecond(now.secondOfDay)}`}</bdi>} />
      </div>

      <h2>Ba lỗi nhỏ của bản gốc</h2>
      <table className='wh-bugs'>
        <thead>
          <tr>
            <th>Tình huống</th>
            <th>Kiểu bản gốc</th>
            <th>Bản viết lại</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Quán cà phê, đúng 07:00:00</td>
            <td className='err'>{fbStyleIsInBrackets(atOpen, cafe) ? 'đang mở' : 'đang đóng'} (so sánh hở hai đầu)</td>
            <td className='ok'>{isInBrackets(atOpen, cafe) ? 'đang mở' : 'đang đóng'} ([from, to))</td>
          </tr>
          <tr>
            <td>31/12 23:30, mở lại 1/1 lúc 07:00</td>
            <td className='err'>"{fbStyleDayLabel(365, 1)}" (so ngày trong năm: 365 + 1 ≠ 1)</td>
            <td className='ok'>"{dayLabel(1, 4)}" (đếm số ngày tới)</td>
          </tr>
          <tr>
            <td>New York 08/03/2026 (đổi giờ mùa hè), mốc 09:00</td>
            <td className='err'>{wallClockAfterAddingSeconds(nyMidnight, parseHHMM('09:00'), 'America/New_York')} (0:00 + 9 giờ)</td>
            <td className='ok'>09:00 (so giờ treo tường qua Intl)</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

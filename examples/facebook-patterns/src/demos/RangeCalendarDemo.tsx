import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  buildMonthGrid,
  daysInMonth,
  fbStyleWeekNumber,
  fromYMD,
  moveCursor,
  roundedEdges,
  toYMD,
  type DayCell,
  type EpochDay,
} from '../lib/rangeCalendar';
import { Stat } from './shared';
import './RangeCalendarDemo.css';

const DAY_NAMES = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
type Strip = 'row' | 'naive';

function fmt(day: EpochDay) {
  const { year, month, day: d } = toYMD(day);
  return `${String(d).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export default function RangeCalendarDemo() {
  const [weekStart, setWeekStart] = useState(1);
  const [rtl, setRtl] = useState(false);
  const [strip, setStrip] = useState<Strip>('row');
  const [showFbWeek, setShowFbWeek] = useState(true);
  const [anchor, setAnchor] = useState<EpochDay | null>(fromYMD(2026, 10, 6));
  const [end, setEnd] = useState<EpochDay | null>(fromYMD(2026, 10, 23));
  const [hover, setHover] = useState<EpochDay | null>(null);
  const [cursor, setCursor] = useState<EpochDay>(fromYMD(2026, 10, 27));
  const [lastKey, setLastKey] = useState('—');
  const cellRefs = useRef(new Map<EpochDay, HTMLButtonElement>());
  const focusAfterRender = useRef(false);

  const { year, month } = toYMD(cursor);
  const range = anchor !== null ? { a: anchor, b: end ?? hover ?? anchor } : null;
  const grid = buildMonthGrid({ year, month, weekStart, range });

  useEffect(() => {
    if (!focusAfterRender.current) return;
    focusAfterRender.current = false;
    cellRefs.current.get(cursor)?.focus();
  }, [cursor]);

  const select = (day: EpochDay) => {
    if (anchor === null || end !== null) {
      setAnchor(day);
      setEnd(null);
    } else {
      setEnd(day);
    }
    setCursor(day);
  };

  const onKeyDown = (event: KeyboardEvent, day: EpochDay) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setLastKey(event.key === ' ' ? 'Space' : 'Enter');
      select(day);
      return;
    }
    const next = moveCursor(day, event, rtl);
    if (next === null) return;
    event.preventDefault();
    setLastKey(`${event.ctrlKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.key}`);
    focusAfterRender.current = true;
    setCursor(next);
    if (anchor !== null && end === null) setHover(next);
  };

  const columns = Array.from({ length: 7 }, (_, i) => DAY_NAMES[(weekStart + i) % 7]);
  const selectedDays = range ? Math.abs(range.b - range.a) + 1 : 0;

  const renderCell = (cell: DayCell) => {
    const edges = roundedEdges(cell);
    const naiveLeft = cell.rangePosition === 'start';
    const naiveRight = cell.rangePosition === 'end';
    const left = strip === 'row' ? edges.left || edges.only : naiveLeft;
    const right = strip === 'row' ? edges.right || edges.only : naiveRight;
    return (
      <button
        key={cell.day}
        ref={(el) => {
          if (el) cellRefs.current.set(cell.day, el);
          else cellRefs.current.delete(cell.day);
        }}
        role='gridcell'
        className='rc-day'
        data-in-range={cell.rangePosition !== null || undefined}
        data-endpoint={cell.rangePosition === 'start' || cell.rangePosition === 'end' || undefined}
        data-left={left || undefined}
        data-right={right || undefined}
        data-cursor={cell.day === cursor || undefined}
        aria-selected={cell.rangePosition !== null}
        aria-label={fmt(cell.day)}
        tabIndex={cell.day === cursor ? 0 : -1}
        onMouseDown={(e) => e.preventDefault() /* click không cướp focus khỏi ô đang có con trỏ */}
        onClick={() => select(cell.day)}
        onMouseEnter={() => anchor !== null && end === null && setHover(cell.day)}
        onKeyDown={(e) => onKeyDown(e, cell.day)}
      >
        <span>{cell.dayOfMonth}</span>
      </button>
    );
  };

  return (
    <div className='page rc'>
      <h1>Lịch chọn khoảng ngày</h1>
      <p className='hint'>
        Bấm một ngày rồi một ngày khác để chọn khoảng (chọn ngược chiều cũng được). Tab vào lưới rồi thử mũi tên, Home/End,
        PageUp/PageDown, Ctrl+PageUp, Enter. Đổi "Dải chọn" để thấy vì sao cần biết vị trí của ô trong hàng.
      </p>

      <div className='toolbar'>
        <button onClick={() => setCursor(moveCursor(cursor, { key: 'PageUp' })!)} aria-label='Tháng trước'>
          ‹
        </button>
        <b className='rc-title'>
          Tháng {month}/{year}
        </b>
        <button onClick={() => setCursor(moveCursor(cursor, { key: 'PageDown' })!)} aria-label='Tháng sau'>
          ›
        </button>
        <label>
          Tuần bắt đầu{' '}
          <select value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))}>
            <option value={1}>thứ Hai</option>
            <option value={0}>Chủ nhật</option>
          </select>
        </label>
        <label>
          Dải chọn{' '}
          <select value={strip} onChange={(e) => setStrip(e.target.value as Strip)}>
            <option value='row'>bo góc theo hàng (Facebook)</option>
            <option value='naive'>chỉ bo hai đầu khoảng</option>
          </select>
        </label>
        <label>
          <input type='checkbox' checked={rtl} onChange={(e) => setRtl(e.target.checked)} /> RTL
        </label>
        <label>
          <input type='checkbox' checked={showFbWeek} onChange={(e) => setShowFbWeek(e.target.checked)} /> cột tuần kiểu
          Facebook
        </label>
      </div>

      <div className='stats'>
        <Stat label='từ ngày' value={range ? fmt(Math.min(range.a, range.b)) : '—'} />
        <Stat label='đến ngày' value={range ? fmt(Math.max(range.a, range.b)) : '—'} />
        <Stat label='số ngày' value={selectedDays} />
        <Stat label='phím vừa bấm' value={<bdi>{lastKey}</bdi>} />
      </div>

      <div className='rc-grid' role='grid' dir={rtl ? 'rtl' : 'ltr'} aria-label={`Tháng ${month}/${year}`}>
        <div className='rc-row rc-head' role='row'>
          <span role='columnheader' className='rc-week' title='Số tuần ISO'>
            Tuần
          </span>
          {showFbWeek && (
            <span role='columnheader' className='rc-week rc-fb' title='Cách Facebook tính'>
              FB
            </span>
          )}
          {columns.map((name) => (
            <span key={name} role='columnheader' className='rc-name'>
              {name}
            </span>
          ))}
        </div>
        {grid.rows.map((row, index) => {
          const lastDay = [...row].reverse().find(Boolean) as DayCell | undefined;
          const fbWeek = lastDay ? fbStyleWeekNumber(lastDay.day) : 0;
          return (
            <div className='rc-row' role='row' key={index}>
              <span role='rowheader' className='rc-week'>
                {grid.weekNumbers[index] || ''}
              </span>
              {showFbWeek && (
                <span
                  className='rc-week rc-fb'
                  data-wrong={(lastDay && fbWeek !== grid.weekNumbers[index]) || undefined}
                  title='Ngày cuối hàng là Chủ nhật thì +1 ngày rồi mới tính tuần'
                >
                  {lastDay ? fbWeek : ''}
                </span>
              )}
              {row.map((cell, i) => (cell ? renderCell(cell) : <span key={`pad-${i}`} className='rc-pad' role='gridcell' />))}
            </div>
          );
        })}
      </div>
      <p className='hint'>
        Ô đỏ ở cột "FB": số tuần lệch so với ISO. Bản gốc lấy <b>ngày cuối hàng</b>, Chủ nhật thì cộng một ngày rồi mới
        tính. Với tuần bắt đầu từ thứ Hai, ngày cuối hàng luôn là Chủ nhật nên bị đẩy sang tuần sau. Tháng này có{' '}
        {daysInMonth(year, month)} ngày.
      </p>
    </div>
  );
}

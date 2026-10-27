import { useEffect, useMemo, useRef, useState, type CSSProperties, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  dropTarget,
  hoursInDay,
  makeDraggable,
  slotToUtc,
  slotToUtcNaive,
  snap,
  wallClock,
  type CalendarDay,
} from '../lib/calendarDrag';
import { Log, Stat, useLog } from './shared';
import './CalendarDragDemo.css';

const TZ = 'Europe/Berlin';
const HOUR = 40; // px cho một giờ trên lưới
const STEP = HOUR / 4; // 15 phút

const WEEKS: Record<string, { label: string; days: CalendarDay[] }> = {
  autumn: {
    label: 'Tuần lùi giờ (25/10/2026)',
    days: [
      { year: 2026, month: 10, day: 24 },
      { year: 2026, month: 10, day: 25 },
      { year: 2026, month: 10, day: 26 },
    ],
  },
  spring: {
    label: 'Tuần tiến giờ (28/3/2027)',
    days: [
      { year: 2027, month: 3, day: 27 },
      { year: 2027, month: 3, day: 28 },
      { year: 2027, month: 3, day: 29 },
    ],
  },
};

type Mode = 'wall' | 'naive';

interface CalendarEvent {
  id: string;
  title: string;
  /** thời điểm bắt đầu (UTC ms), null nếu là việc cả ngày */
  start: number | null;
  /** ngày của việc cả ngày */
  allDay?: CalendarDay;
  minutes: number;
}

interface Preview {
  id: string;
  dayIndex: number;
  /** phút từ 00:00 trên lưới, null = dải cả ngày */
  minutes: number | null;
}

const sameDay = (a: CalendarDay, b: { year: number; month: number; day: number }) =>
  a.year === b.year && a.month === b.month && a.day === b.day;

const fmtDay = (d: CalendarDay) =>
  new Intl.DateTimeFormat('vi', { weekday: 'short', day: '2-digit', month: '2-digit', timeZone: 'UTC' }).format(
    Date.UTC(d.year, d.month - 1, d.day),
  );
const fmtTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const fmtUtc = (ms: number) => new Date(ms).toISOString().slice(11, 16) + 'Z';

function initialEvents(days: CalendarDay[]): CalendarEvent[] {
  return [
    { id: 'a', title: 'Họp đầu tuần', start: slotToUtc(days[0], 9 * 60, TZ), minutes: 60 },
    { id: 'b', title: 'Chạy bộ', start: slotToUtc(days[1], 7 * 60, TZ), minutes: 45 },
    { id: 'c', title: 'Review PR', start: slotToUtc(days[2], 14 * 60, TZ), minutes: 90 },
    { id: 'd', title: 'Đổi giờ đồng hồ', start: null, allDay: days[1], minutes: 0 },
  ];
}

export default function CalendarDragDemo() {
  const [weekKey, setWeekKey] = useState<keyof typeof WEEKS>('autumn');
  const days = WEEKS[weekKey].days;
  const [mode, setMode] = useState<Mode>('naive');
  const [events, setEvents] = useState(() => initialEvents(days));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [counts, setCounts] = useState({ moves: 0, updates: 0 });
  const { lines, add } = useLog(14);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents(initialEvents(WEEKS[weekKey].days));
    // cuộn tới 07:00 cho dễ thấy
    if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR - 10;
  }, [weekKey]);

  // vị trí hiển thị của sự kiện tính từ thời điểm UTC đã lưu -> giờ treo tường ở Berlin
  const placed = useMemo(
    () =>
      events.map((ev) => {
        if (ev.start === null) return { ev, dayIndex: days.findIndex((d) => sameDay(d, ev.allDay!)), minutes: null };
        const w = wallClock(ev.start, TZ);
        return { ev, dayIndex: days.findIndex((d) => sameDay(d, w)), minutes: w.hour * 60 + w.minute };
      }),
    [events, days],
  );

  const onDrop = (p: Preview) => {
    const day = days[p.dayIndex];
    if (p.minutes === null) {
      setEvents((all) => all.map((e) => (e.id === p.id ? { ...e, start: null, allDay: day } : e)));
      add(`Thả "${events.find((e) => e.id === p.id)?.title}" vào dải cả ngày ${fmtDay(day)}`, 'ok');
      return;
    }
    const minutes = p.minutes;
    const utc = mode === 'wall' ? slotToUtc(day, minutes, TZ) : slotToUtcNaive(day, minutes, TZ);
    const w = wallClock(utc, TZ);
    const shown = w.hour * 60 + w.minute;
    setEvents((all) => all.map((e) => (e.id === p.id ? { ...e, start: utc, allDay: undefined, minutes: e.minutes || 60 } : e)));
    const ok = shown === minutes && sameDay(day, w);
    add(
      `Thả ở ô ${fmtDay(day)} ${fmtTime(minutes)} → lưu ${fmtUtc(utc)} → hiển thị ${fmtTime(shown)}${ok ? '' : '  (lệch!)'}`,
      ok ? 'ok' : 'err',
    );
  };

  return (
    <div className='page calendar-drag'>
      <h1>Kéo-thả trên lịch</h1>
      <p className='hint'>
        Múi giờ: <b>{TZ}</b>. Kéo một sự kiện sang ngày đổi giờ rồi thả sau 03:00. Ở chế độ "cộng phút từ nửa đêm",
        sự kiện nhảy lệch 1 tiếng so với ô bạn thả. Kéo gần mép trên/dưới để lịch tự cuộn; bấm (không kéo) để mở chi
        tiết; <kbd>Esc</kbd> để huỷ khi đang kéo.
      </p>
      <div className='toolbar'>
        {Object.entries(WEEKS).map(([key, w]) => (
          <button key={key} className={key === weekKey ? 'primary' : ''} onClick={() => setWeekKey(key as keyof typeof WEEKS)}>
            {w.label}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <span className='muted'>Đổi ô lịch thành giờ:</span>
        <button className={mode === 'naive' ? 'primary' : ''} onClick={() => setMode('naive')}>
          Cộng phút từ nửa đêm
        </button>
        <button className={mode === 'wall' ? 'primary' : ''} onClick={() => setMode('wall')}>
          Giờ treo tường
        </button>
      </div>
      <div className='stats'>
        <Stat label='pointermove + tự cuộn' value={counts.moves} />
        <Stat label='lần cập nhật bản xem trước' value={counts.updates} />
      </div>

      <div className='cd-calendar'>
        <div className='cd-head'>
          <div className='cd-gutter' />
          {days.map((d) => (
            <div key={`${d.month}-${d.day}`} className='cd-dayname'>
              {fmtDay(d)} <span className='muted'>· {hoursInDay(d, TZ)}h</span>
            </div>
          ))}
        </div>
        <div className='cd-allday-row'>
          <div className='cd-gutter muted'>cả ngày</div>
          <div className='cd-allday' data-drop-area='allday'>
            {placed
              .filter((p) => p.minutes === null && p.dayIndex >= 0)
              .map(({ ev, dayIndex }) => (
                <EventChip
                  key={ev.id}
                  ev={ev}
                  style={{ left: `calc(${(dayIndex * 100) / days.length}% + 3px)`, width: `calc(${100 / days.length}% - 6px)` }}
                  dimmed={preview?.id === ev.id}
                  scrollRef={scrollRef}
                  days={days}
                  onPreview={setPreview}
                  onDrop={onDrop}
                  onCount={setCounts}
                  log={add}
                  label={ev.title}
                />
              ))}
            {preview && preview.minutes === null && (
              <div
                className='cd-chip cd-preview'
                style={{ left: `calc(${(preview.dayIndex * 100) / days.length}% + 3px)`, width: `calc(${100 / days.length}% - 6px)` }}
              >
                {events.find((e) => e.id === preview.id)?.title}
              </div>
            )}
          </div>
        </div>
        <div className='cd-scroll' ref={scrollRef}>
          <div className='cd-body'>
            <div className='cd-gutter'>
              {Array.from({ length: 24 }, (_, h) => (
                <div key={h} className='cd-hour-label' style={{ top: h * HOUR }}>
                  {fmtTime(h * 60)}
                </div>
              ))}
            </div>
            <div className='cd-grid' data-drop-area='grid' style={{ height: 24 * HOUR }}>
              {days.map((_, i) => (
                <div key={i} className='cd-col' style={{ left: `${(i * 100) / days.length}%`, width: `${100 / days.length}%` }} />
              ))}
              {placed
                .filter((p) => p.minutes !== null && p.dayIndex >= 0)
                .map(({ ev, dayIndex, minutes }) => (
                  <EventChip
                    key={ev.id}
                    ev={ev}
                    style={{
                      top: ((minutes as number) / 60) * HOUR,
                      height: (ev.minutes / 60) * HOUR - 2,
                      left: `calc(${(dayIndex * 100) / days.length}% + 3px)`,
                      width: `calc(${100 / days.length}% - 6px)`,
                    }}
                    dimmed={preview?.id === ev.id}
                    scrollRef={scrollRef}
                    days={days}
                    onPreview={setPreview}
                    onDrop={onDrop}
                    onCount={setCounts}
                    log={add}
                    label={`${fmtTime(minutes as number)} ${ev.title}`}
                  />
                ))}
              {preview && preview.minutes !== null && (
                <div
                  className='cd-chip cd-preview'
                  style={{
                    top: (preview.minutes / 60) * HOUR,
                    height: ((events.find((e) => e.id === preview.id)?.minutes || 60) / 60) * HOUR - 2,
                    left: `calc(${(preview.dayIndex * 100) / days.length}% + 3px)`,
                    width: `calc(${100 / days.length}% - 6px)`,
                  }}
                >
                  {fmtTime(preview.minutes)} {events.find((e) => e.id === preview.id)?.title}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}

interface ChipProps {
  ev: CalendarEvent;
  style: CSSProperties;
  dimmed: boolean;
  label: string;
  days: CalendarDay[];
  scrollRef: RefObject<HTMLDivElement | null>;
  onPreview: (p: Preview | null) => void;
  onDrop: (p: Preview) => void;
  onCount: Dispatch<SetStateAction<{ moves: number; updates: number }>>;
  log: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void;
}

function EventChip(props: ChipProps) {
  const ref = useRef<HTMLDivElement>(null);
  // handler luôn đọc props mới nhất mà không phải gắn lại listener mỗi lần render
  const latest = useRef(props);
  latest.current = props;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let grabOffset = 0; // con trỏ cách mép trên sự kiện bao nhiêu px, để sự kiện không "nhảy" khi bắt đầu kéo
    let current: Preview | null = null;

    const compute = (event: PointerEvent): Preview | null => {
      const { days, ev } = latest.current;
      const target = dropTarget(event.clientX, event.clientY);
      if (!target) return null;
      const dayIndex = Math.min(days.length - 1, Math.max(0, Math.floor(target.x / (target.width / days.length))));
      if (target.name === 'allday') return { id: ev.id, dayIndex, minutes: null };
      const top = snap(target.y - grabOffset, STEP);
      const minutes = Math.min(24 * 60 - 15, Math.max(0, (top / HOUR) * 60));
      return { id: ev.id, dayIndex, minutes };
    };

    return makeDraggable(el, {
      threshold: 6,
      scrollContainer: () => latest.current.scrollRef.current,
      onStart: (event) => {
        const rect = el.getBoundingClientRect();
        grabOffset = latest.current.ev.start === null ? 0 : event.clientY - rect.top;
        latest.current.log(`Bắt đầu kéo "${latest.current.ev.title}"`, 'muted');
      },
      onMove: (event) => {
        latest.current.onCount((c) => ({ ...c, moves: c.moves + 1 }));
        const next = compute(event);
        // chỉ cập nhật khi đổi ô (Pipedrive so isEqual với bản xem trước cũ)
        if (!next || (current && next.dayIndex === current.dayIndex && next.minutes === current.minutes)) return;
        current = next;
        latest.current.onCount((c) => ({ ...c, updates: c.updates + 1 }));
        latest.current.onPreview(next);
      },
      onEnd: () => {
        if (current) latest.current.onDrop(current);
        current = null;
        latest.current.onPreview(null);
      },
      onCancel: () => {
        current = null;
        latest.current.onPreview(null);
        latest.current.log('Huỷ kéo', 'warn');
      },
    });
  }, []);

  return (
    <div
      ref={ref}
      className={`cd-chip${props.dimmed ? ' dimmed' : ''}`}
      style={props.style}
      role='button'
      tabIndex={0}
      onClick={() => props.log(`Mở chi tiết "${props.ev.title}"`)}
      onKeyDown={(e) => e.key === 'Enter' && props.log(`Mở chi tiết "${props.ev.title}" (bàn phím)`)}
    >
      {props.label}
    </div>
  );
}

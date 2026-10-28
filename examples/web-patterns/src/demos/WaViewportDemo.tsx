import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  StickyDateController,
  captureBottomGap,
  findStickyDateIndex,
  findVisibleRange,
  leftViewport,
  restoreBottomGap,
} from '../lib/waViewport';
import { Log, Stat, useLog } from './shared';

interface Msg {
  i: number;
  day: number;
  fromMe: boolean;
  text: string;
  gif: boolean;
}

const DAYS = 30;
const PER_DAY = 20;
const PHRASES = [
  'ok',
  'mai gặp nhé',
  'gửi mình file báo cáo tuần này với, cần trước 5 giờ chiều',
  'haha 😂',
  'đang trên đường tới, kẹt xe quá, chắc trễ khoảng mười lăm phút',
  'cảm ơn bạn nhiều',
  'tối nay ăn gì? lẩu hay nướng? mình thì sao cũng được, miễn là gần chỗ gửi xe',
];

function buildChat(): Msg[] {
  let seed = 3;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const out: Msg[] = [];
  for (let d = 0; d < DAYS; d++)
    for (let k = 0; k < PER_DAY; k++) {
      const i = out.length;
      out.push({ i, day: d, fromMe: rand() < 0.45, text: PHRASES[Math.floor(rand() * PHRASES.length)], gif: i % 23 === 11 });
    }
  return out;
}

const BASE = new Date(2026, 8, 28);
const dayLabel = (d: number) =>
  new Date(BASE.getTime() + d * 86_400_000).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });

export default function WaViewportDemo() {
  const msgs = useMemo(buildChat, []);
  const boxRef = useRef<HTMLDivElement>(null);
  const msgEls = useRef<(HTMLElement | null)[]>([]);
  const markerEls = useRef<(HTMLElement | null)[]>([]);
  const playing = useRef(new Map<number, HTMLElement>());
  const anchor = useRef<{ index: number; gap: number } | null>(null);
  const [sticky, setSticky] = useState(false);
  const [dateIdx, setDateIdx] = useState(-1);
  const [range, setRange] = useState({ first: -1, last: -1, reads: 0 });
  const [paused, setPaused] = useState(0);
  const [drawer, setDrawer] = useState(false);
  const [keepAnchor, setKeepAnchor] = useState(true);
  const { lines, add } = useLog(20);
  const controller = useMemo(() => new StickyDateController({ onVisibility: setSticky }), []);
  const raf = useRef(0);

  function update(silent = false) {
    const box = boxRef.current;
    if (!box) return;
    const r = findVisibleRange(msgs.length, (i) => msgEls.current[i], box);
    setRange(r);
    const idx = findStickyDateIndex(DAYS, (d) => markerEls.current[d]?.offsetTop ?? Infinity, box.scrollTop);
    setDateIdx(idx);
    controller.onPositionChange(silent);

    const next = new Map<number, HTMLElement>();
    for (let i = r.first; i >= 0 && i <= r.last; i++) {
      const el = msgEls.current[i];
      if (msgs[i].gif && el) {
        next.set(i, el);
        el.classList.add('playing');
      }
    }
    const left = leftViewport(playing.current, next);
    left.forEach((el) => el.classList.remove('playing'));
    if (left.length) setPaused((n) => n + left.length);
    playing.current = next;
  }

  function onScroll() {
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => update());
  }

  useEffect(() => {
    const box = boxRef.current!;
    controller.markProgrammatic();
    box.scrollTop = box.scrollHeight;
    update(true);
    return () => {
      controller.dispose();
      cancelAnimationFrame(raf.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function programmaticJump() {
    const box = boxRef.current!;
    const target = markerEls.current[DAYS - 8];
    if (!target) return;
    controller.markProgrammatic();
    box.scrollTop = target.offsetTop;
    add('Cuộn bằng code tới 7 ngày trước: sticky date không bật lên', 'muted');
  }

  function toggleDrawer() {
    const box = boxRef.current!;
    const last = range.last;
    const el = msgEls.current[last];
    anchor.current = keepAnchor && el ? { index: last, gap: captureBottomGap(box, el) } : null;
    if (el) el.dataset.before = String(captureBottomGap(box, el));
    setDrawer((d) => !d);
  }

  useLayoutEffect(() => {
    const box = boxRef.current!;
    const el = msgEls.current[range.last];
    if (anchor.current) {
      const target = msgEls.current[anchor.current.index]!;
      controller.markProgrammatic();
      restoreBottomGap(box, target, anchor.current.gap);
      add(`Panel ${drawer ? 'mở' : 'đóng'}: giữ tin #${anchor.current.index + 1} ở đúng chỗ (lệch 0px)`, 'ok');
      anchor.current = null;
    } else if (el?.dataset.before) {
      const drift = Math.round(captureBottomGap(box, el) - Number(el.dataset.before));
      add(`Panel ${drawer ? 'mở' : 'đóng'} không giữ neo: tin #${range.last + 1} trôi ${drift}px`, drift ? 'warn' : 'ok');
    }
    if (el) delete el.dataset.before;
    update(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawer]);

  const linearReads = range.first < 0 ? 0 : range.last + 2;

  return (
    <div className='page wa-vp'>
      <h1>Theo dõi viewport tin nhắn</h1>
      <p className='hint'>
        600 tin trong 30 ngày. Mỗi lần cuộn (gom theo requestAnimationFrame) demo tìm tin đang thấy và date
        marker bằng binary search. Ngày dính ở đỉnh tự ẩn sau 3 giây; ô GIF chỉ chạy khi đang thấy.
      </p>
      <div className='toolbar'>
        <button onClick={programmaticJump} data-testid='jump'>
          Cuộn bằng code tới 7 ngày trước
        </button>
        <button className='primary' onClick={toggleDrawer} data-testid='drawer'>
          {drawer ? 'Đóng panel thông tin' : 'Mở panel thông tin'}
        </button>
        <label>
          <input type='checkbox' checked={keepAnchor} onChange={(e) => setKeepAnchor(e.target.checked)} /> giữ neo khi
          đổi layout
        </label>
      </div>
      <div className='stats'>
        <Stat label='tin đang thấy' value={range.first < 0 ? '—' : `#${range.first + 1} … #${range.last + 1}`} />
        <Stat label='lần đọc vị trí' value={`${range.reads} (quét: ${linearReads})`} />
        <Stat label='date marker' value={dateIdx < 0 ? '—' : dayLabel(dateIdx)} />
        <Stat label='GIF đã pause' value={paused} />
      </div>
      <div className='wa-vp-layout'>
        <div className='wa-vp-wrap'>
          <div className={`wa-vp-sticky ${sticky && dateIdx >= 0 ? 'on' : ''}`} data-testid='sticky'>
            {dateIdx >= 0 ? dayLabel(dateIdx) : ''}
          </div>
          <div className='wa-vp-box' ref={boxRef} onScroll={onScroll} data-testid='box'>
            {msgs.map((m) => (
              <div key={m.i}>
                {m.i % PER_DAY === 0 && (
                  <div
                    className={`wa-vp-marker ${sticky && dateIdx === m.day ? 'under' : ''}`}
                    ref={(el) => {
                      markerEls.current[m.day] = el;
                    }}
                  >
                    <span>{dayLabel(m.day)}</span>
                  </div>
                )}
                <div
                  className={`wa-vp-msg ${m.fromMe ? 'me' : ''}`}
                  ref={(el) => {
                    msgEls.current[m.i] = el;
                  }}
                >
                  {m.gif ? <span className='wa-vp-gif'>GIF</span> : null} <span className='muted'>#{m.i + 1}</span> {m.text}
                </div>
              </div>
            ))}
          </div>
        </div>
        {drawer && (
          <aside className='wa-vp-drawer card'>
            <b>Thông tin nhóm</b>
            <p className='muted'>Panel chiếm chỗ nên bong bóng tin hẹp lại, chữ xuống dòng, chiều cao đổi.</p>
          </aside>
        )}
      </div>
      <Log lines={lines} />
      <style>{`
        .wa-vp-layout { display: flex; gap: 8px; }
        .wa-vp-wrap { position: relative; flex: 1; min-width: 0; }
        .wa-vp-box { position: relative; height: 420px; overflow-y: auto; border: 1px solid var(--border); border-radius: 10px; padding: 8px; background: var(--surface-2); overflow-anchor: none; }
        .wa-vp-drawer { flex: 0 0 40%; margin: 0; box-sizing: border-box; }
        .wa-vp-msg { max-width: 78%; width: fit-content; margin: 3px 0; padding: 6px 10px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); font-size: 14px; overflow-wrap: anywhere; }
        .wa-vp-msg.me { margin-left: auto; background: color-mix(in srgb, #25d366 18%, var(--surface)); }
        .wa-vp-marker { text-align: center; margin: 10px 0; }
        .wa-vp-marker span, .wa-vp-sticky { display: inline-block; padding: 3px 10px; border-radius: 8px; font-size: 12px; background: var(--surface); border: 1px solid var(--border); }
        .wa-vp-marker.under { visibility: hidden; }
        .wa-vp-sticky { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); z-index: 2; opacity: 0; transition: opacity .3s; pointer-events: none; white-space: nowrap; }
        .wa-vp-sticky.on { opacity: 1; }
        .wa-vp-gif { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 11px; font-weight: 700; color: #fff; background: #888; }
        .wa-vp-msg.playing .wa-vp-gif { background: linear-gradient(90deg, #25d366, #128c7e, #25d366); background-size: 200% 100%; animation: wa-vp-gif 1s linear infinite; }
        @keyframes wa-vp-gif { to { background-position: -200% 0; } }
      `}</style>
    </div>
  );
}

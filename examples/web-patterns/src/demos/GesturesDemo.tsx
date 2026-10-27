import { useEffect, useRef, useState } from 'react';
import { captureGestures, type SwipeDirection } from '../lib/captureGestures';
import { legacyCaptureEvents } from './GesturesLegacy';
import { Log, Stat, useLog } from './shared';
import './GesturesDemo.css';

const SLIDES = ['🏔️ Núi', '🌊 Biển', '🏙️ Phố', '🌲 Rừng'];
type Mode = 'pointer' | 'legacy';

export default function GesturesDemo() {
  const [mode, setMode] = useState<Mode>('pointer');
  const [index, setIndex] = useState(0);
  const [offset, setOffset] = useState(0);
  const [stats, setStats] = useState({ clicks: 0, swipeCalls: 0, lastSwipeCalls: 0 });
  const [linkClicks, setLinkClicks] = useState(0);
  const { lines, add } = useLog(40);
  const trackRef = useRef<HTMLDivElement>(null);
  const swipeCallsInGesture = useRef(0);
  const indexRef = useRef(0);
  indexRef.current = index;

  useEffect(() => {
    const el = trackRef.current!;
    const go = (dir: SwipeDirection) => {
      swipeCallsInGesture.current++;
      setStats((s) => ({ ...s, swipeCalls: s.swipeCalls + 1 }));
      // giống cách Telegram dùng: tính từ giá trị đọc lúc đó; bản cũ gọi nhiều lần nên
      // kết quả chỉ đúng khi phép tính "idempotent" (min/max) trên giá trị cũ
      const current = indexRef.current;
      if (dir === 'left') setIndex(Math.min(current + 1, SLIDES.length - 1));
      if (dir === 'right') setIndex(Math.max(current - 1, 0));
    };
    const finish = () => {
      setOffset(0);
      const n = swipeCallsInGesture.current;
      setStats((s) => ({ ...s, lastSwipeCalls: n }));
      if (n) add(`thả tay: onSwipe đã được gọi ${n} lần trong cử chỉ này`, n > 1 ? 'warn' : 'ok');
      swipeCallsInGesture.current = 0;
    };
    const click = (source: string) => {
      setStats((s) => ({ ...s, clicks: s.clicks + 1 }));
      add(`onClick (${source})`);
    };

    if (mode === 'legacy') {
      return legacyCaptureEvents(el, {
        onDrag: (dx) => setOffset(dx),
        onSwipe: go,
        onRelease: finish,
        onClick: click,
      });
    }
    return captureGestures(el, {
      axis: 'x',
      onDrag: (_, { dx, axis }) => setOffset(axis === 'y' ? 0 : dx),
      onSwipe: (dir) => go(dir),
      onRelease: (_, info) => {
        add(`kéo xong: dx=${Math.round(info.dx)}, dy=${Math.round(info.dy)}, trục=${info.axis ?? 'chưa rõ (chéo)'}`, 'muted');
        finish();
      },
      onClick: (e) => click(`pointer: ${e.pointerType}`),
    });
  }, [mode, add]);

  return (
    <div className='page gs-demo'>
      <h1>Kéo, vuốt chung cho chuột và cảm ứng</h1>
      <p className='hint'>
        Kéo ngang khung ảnh (bằng chuột hoặc ngón tay) để chuyển ảnh, bấm để đếm click. Thử kéo rồi thả lên chữ "Xem chi
        tiết": bản Pointer Events chặn click nhầm sau khi kéo. Trên điện thoại, bản cũ gọi onClick hai lần khi chạm.
      </p>
      <div className='toolbar'>
        <button className={mode === 'pointer' ? 'primary' : ''} onClick={() => setMode('pointer')}>
          Pointer Events (viết lại)
        </button>
        <button className={mode === 'legacy' ? 'primary' : ''} onClick={() => setMode('legacy')}>
          Mouse + touch (kiểu bản gốc)
        </button>
      </div>
      <div className='stats'>
        <Stat label='onClick đã gọi' value={stats.clicks} />
        <Stat label='onSwipe trong cử chỉ vừa rồi' value={stats.lastSwipeCalls} />
        <Stat label='click vào link' value={linkClicks} />
      </div>

      <div className='gs-viewport'>
        <div
          ref={trackRef}
          className='gs-track'
          style={{ transform: `translateX(calc(${-index * 100}% + ${offset}px))`, transition: offset ? 'none' : undefined }}
        >
          {SLIDES.map((s) => (
            <div className='gs-slide' key={s}>
              <span className='gs-emoji'>{s}</span>
              <a
                href='#/gestures'
                className='gs-link'
                // link và ảnh mặc định kéo được (HTML drag and drop): bấm giữ rồi kéo sẽ bắt đầu kéo-thả
                // của trình duyệt thay vì cử chỉ của ta
                draggable={false}
                onClick={(e) => {
                  e.preventDefault();
                  setLinkClicks((n) => n + 1);
                  add('click vào link "Xem chi tiết"', 'warn');
                }}
              >
                Xem chi tiết
              </a>
            </div>
          ))}
        </div>
      </div>
      <div className='gs-dots'>
        {SLIDES.map((s, i) => (
          <span key={s} className={i === index ? 'on' : ''} />
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import {
  attachPerspectiveScrollbar,
  perspectiveScrollerStyle,
  perspectiveThumbStyle,
  perspectiveTrackStyle,
  type ThumbMetrics,
} from '../lib/perspectiveScrollbar';
import { Stat } from './shared';
import './ScrollbarDemo.css';

function Rows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className='sb-row'>
          Dòng {i + 1}
        </div>
      ))}
    </>
  );
}

function PerspectiveArea({ rows, onMetrics }: { rows: number; onMetrics: (m: ThumbMetrics) => void }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  useEffect(() => {
    const [scroller, content, thumb, track] = [scrollerRef.current, contentRef.current, thumbRef.current, trackRef.current];
    if (!scroller || !content || !thumb || !track) return;
    return attachPerspectiveScrollbar({ scroller, content, thumb, track }, { onMetrics: (m) => onMetricsRef.current(m) });
  }, []);

  return (
    // tabIndex=0: vùng cuộn không chứa phần tử focus được thì người dùng bàn phím vẫn cuộn được
    <div
      ref={scrollerRef}
      className='sb-area'
      style={perspectiveScrollerStyle}
      tabIndex={0}
      aria-label='Danh sách cuộn với thanh cuộn tuỳ biến'
      data-testid='perspective-area'
    >
      <div ref={contentRef} className='sb-content'>
        <Rows count={rows} />
      </div>
      {/* thumb + track chỉ để nhìn và kéo bằng chuột; trình đọc màn hình bỏ qua */}
      <div ref={trackRef} className='sb-track' style={perspectiveTrackStyle} aria-hidden />
      <div ref={thumbRef} style={perspectiveThumbStyle} aria-hidden data-testid='perspective-thumb'>
        <div className='sb-thumb-inner' />
      </div>
    </div>
  );
}

/** Cách thông thường: nghe `scroll` rồi set transform cho thumb, chạy trên main thread. */
function JsArea({ rows }: { rows: number }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const thumb = thumbRef.current;
    if (!scroller || !thumb) return;
    const update = () => {
      const { clientHeight: b, scrollHeight: a, scrollTop } = scroller;
      const h = (b * b) / a;
      thumb.style.height = `${h}px`;
      thumb.style.transform = `translateY(${(scrollTop / (a - b)) * (b - h)}px)`;
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [rows]);

  return (
    <div className='sb-js-wrap'>
      <div ref={scrollerRef} className='sb-area sb-js-area'>
        <div className='sb-content'>
          <Rows count={rows} />
        </div>
      </div>
      <div ref={thumbRef} className='sb-js-thumb' />
    </div>
  );
}

export default function ScrollbarDemo() {
  const [rows, setRows] = useState(40);
  const [busy, setBusy] = useState(false);
  const [metrics, setMetrics] = useState<ThumbMetrics | null>(null);

  // Chặn main thread: cứ mỗi 200ms thì bận liên tục 180ms
  useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => {
      const end = performance.now() + 180;
      while (performance.now() < end) {
        /* bận */
      }
    }, 200);
    return () => clearInterval(id);
  }, [busy]);

  return (
    <div className='page'>
      <h1>Thanh cuộn tuỳ biến bằng CSS 3D</h1>
      <p className='hint'>
        Bật "Chặn main thread" rồi cuộn cả hai khung bằng chuột hoặc touchpad. Thumb bên trái được
        trình duyệt di chuyển trên compositor nên vẫn bám theo nội dung. Thumb đỏ bên phải cập nhật
        bằng JS trong sự kiện scroll nên bị giật hoặc đứng yên.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={busy} onChange={(e) => setBusy(e.target.checked)} />
          Chặn main thread (180ms / 200ms)
        </label>
        <button onClick={() => setRows((r) => r + 20)}>Thêm 20 dòng</button>
        <button onClick={() => setRows((r) => Math.max(5, r - 20))}>Bớt 20 dòng</button>
      </div>
      <div className='sb-grid'>
        <div className='sb-box'>
          <h2>perspective + matrix3d (Facebook)</h2>
          <PerspectiveArea rows={rows} onMetrics={setMetrics} />
        </div>
        <div className='sb-box'>
          <h2>JS cập nhật theo sự kiện scroll</h2>
          <JsArea rows={rows} />
        </div>
      </div>
      {metrics && (
        <>
          <div className='stats'>
            <Stat label='viewport b (px)' value={Math.round(metrics.viewport)} />
            <Stat label='nội dung a (px)' value={Math.round(metrics.content)} />
            <Stat label='thumb = b²/a (px)' value={metrics.thumbHeight.toFixed(1)} />
            <Stat label='ratio = (b - thumb)/(a - b)' value={metrics.ratio.toFixed(4)} />
          </div>
          <div className='card sb-metrics'>transform: {metrics.transform}</div>
        </>
      )}
    </div>
  );
}

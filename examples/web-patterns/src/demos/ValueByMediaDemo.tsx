import { useCallback, useEffect, useRef, useState } from 'react';
import { BREAKPOINTS, useValueByMedia } from '../lib/useValueByMedia';
import { Stat } from './shared';
import './ValueByMediaDemo.css';

// ---- Bản "giống gốc" để so sánh: listener + debounce 50ms, đăng ký lại sau mỗi lần render ----
let legacySubscriptions = 0;

function useValueByMediaLegacy<T>(values: { default: T } & Record<string, T>): T {
  const entries = Object.entries(values)
    .filter(([k]) => k !== 'default')
    .map(([k, v]) => [BREAKPOINTS[k as keyof typeof BREAKPOINTS] ?? k, v] as const);
  const [value, setValue] = useState(values.default);
  const matched = useRef<Record<string, boolean>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // `entries` là mảng mới mỗi render -> effect chạy lại mỗi render -> gỡ rồi gắn lại listener
  useEffect(() => {
    const pick = () => {
      const all = [values.default, ...entries.filter(([q]) => matched.current[q]).map(([, v]) => v)];
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setValue(all[all.length - 1]), 50);
    };
    const cleanups = entries.map(([query]) => {
      const list = window.matchMedia(query);
      const onChange = () => {
        matched.current[query] = list.matches;
        pick();
      };
      list.addEventListener('change', onChange);
      legacySubscriptions++;
      matched.current[query] = list.matches;
      return () => list.removeEventListener('change', onChange);
    });
    pick();
    return () => cleanups.forEach((fn) => fn());
  });
  return value;
}

/** Component riêng đọc bộ đếm định kỳ, để việc hiển thị số không gây render lại InnerPage. */
function LegacyCounter() {
  const [count, setCount] = useState(legacySubscriptions);
  useEffect(() => {
    const id = setInterval(() => setCount(legacySubscriptions), 250);
    return () => clearInterval(id);
  }, []);
  return <Stat label='lần gắn listener (kiểu cũ)' value={count} />;
}

function InnerPage() {
  const columns = useValueByMedia({ default: 1, tablet: 2, desktop: 3, wide: 4 });
  const label = useValueByMedia({ default: 'mobile', tablet: 'tablet', desktop: 'desktop', wide: 'wide' });
  const legacyColumns = useValueByMediaLegacy({ default: 1, tablet: 2, desktop: 3, wide: 4 });
  const [, force] = useState(0);
  const renders = useRef(0);
  renders.current++;
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return (
    <div className='page vbm-inner'>
      <div className='stats'>
        <Stat label='innerWidth' value={`${width}px`} />
        <Stat label='breakpoint' value={label} />
        <Stat label='số cột (mới)' value={columns} />
        <Stat label='số cột (kiểu cũ)' value={legacyColumns} />
        <LegacyCounter />
      </div>
      <div className='toolbar'>
        <button onClick={() => force((n) => n + 1)}>Render lại ({renders.current})</button>
      </div>
      <div className='vbm-grid' style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className='card'>
            Thẻ {i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

const WIDTHS = [375, 768, 1024, 1440];

function OuterPage() {
  const [width, setWidth] = useState(375);
  const theme = new URLSearchParams(location.search).get('theme') ?? '';
  const src = `${location.pathname}?inner=1${theme ? `&theme=${theme}` : ''}#/value-by-media`;
  const setPreset = useCallback((w: number) => setWidth(w), []);
  return (
    <div className='page'>
      <h1>useValueByMedia: giá trị theo breakpoint</h1>
      <p className='hint'>
        Media query tính theo bề rộng <b>viewport</b>, nên demo đặt trang thật trong một iframe có thể đổi bề rộng.
        Kéo thanh trượt qua 768 / 1024 / 1440px, rồi bấm "Render lại" trong khung để xem bản kiểu cũ gắn lại
        listener sau mỗi lần render.
      </p>
      <div className='toolbar'>
        <input
          type='range'
          min={320}
          max={1500}
          value={width}
          aria-label='Bề rộng khung'
          onChange={(e) => setWidth(Number(e.target.value))}
        />
        <b>{width}px</b>
        {WIDTHS.map((w) => (
          <button key={w} onClick={() => setPreset(w)}>
            {w}
          </button>
        ))}
      </div>
      <div className='vbm-viewport'>
        <iframe title='Trang trong khung' src={src} style={{ width }} />
      </div>
    </div>
  );
}

export default function ValueByMediaDemo() {
  const inner = new URLSearchParams(location.search).has('inner');
  return inner ? <InnerPage /> : <OuterPage />;
}

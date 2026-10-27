import { useEffect, useRef, useState } from 'react';
import { columnWidth, getDisplayMode, observeCssValue, readCssNumber, readZIndexProbe, watchDisplayMode, watchWindowResize, type DisplayMode } from '../lib/cssBridge';
import './CssBridgeDemo.css';

const GAP = 12;
const WIDTHS = [320, 560, 820];
const MODES = ['browser', 'standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'];

function BreakpointPanel() {
  const boxRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLDivElement>(null);
  const [observed, setObserved] = useState({ z: 0, v: 0, width: 0 });
  const [windowOnly, setWindowOnly] = useState(0);
  const [boxWidth, setBoxWidth] = useState<number | null>(null);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    const box = boxRef.current!;
    const probe = probeRef.current!;
    const read = () => `${readZIndexProbe(probe)}|${readCssNumber(probe, '--columns', 1)}|${Math.round(box.clientWidth)}`;
    const stopObserve = observeCssValue(box, read, (value) => {
      const [z, v, width] = value.split('|').map(Number);
      setObserved({ z, v, width });
      setReads((n) => n + 1);
    });
    const stopWindow = watchWindowResize(() => readZIndexProbe(probe), setWindowOnly);
    return () => {
      stopObserve();
      stopWindow();
    };
  }, []);

  const colWidth = columnWidth(observed.width, observed.z || 1, GAP);

  return (
    <section className='card cbr-panel'>
      <h2>1. Số cột do CSS quyết định, JS chỉ đọc lại (Ello)</h2>
      <p className='hint'>Kéo góc phải dưới của khung (hoặc bấm nút) để đổi bề rộng. CSS dùng container query đặt số cột; JS đọc ra để tính kích thước ảnh cần tải.</p>
      <div className='toolbar'>
        {WIDTHS.map((w) => (
          <button key={w} onClick={() => setBoxWidth(w)} data-width={w}>
            {w}px
          </button>
        ))}
        <button onClick={() => setBoxWidth(null)}>Tự do</button>
      </div>
      <div className='stats'>
        <div className='stat'>
          <b data-testid='cols-z'>{observed.z}</b>
          <span>z-index của ::after (ResizeObserver)</span>
        </div>
        <div className='stat'>
          <b data-testid='cols-var'>{observed.v}</b>
          <span>--columns (ResizeObserver)</span>
        </div>
        <div className='stat'>
          <b data-testid='cols-window'>{windowOnly}</b>
          <span>z-index, chỉ nghe window.resize</span>
        </div>
        <div className='stat'>
          <b>{reads}</b>
          <span>lần giá trị đổi</span>
        </div>
      </div>
      <div ref={boxRef} className='cbr-box' style={boxWidth ? { width: boxWidth } : undefined} data-testid='box'>
        <div ref={probeRef} className='cbr-probe' aria-hidden='true' />
        <div className='cbr-grid'>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className='cbr-card'>
              <div className='cbr-thumb' style={{ aspectRatio: i % 3 === 0 ? '4 / 5' : '4 / 3' }} />
              <small>
                Ảnh {i + 1}: tải bản {colWidth > 0 ? `${colWidth * 2}px` : '…'} (2x)
              </small>
            </div>
          ))}
        </div>
      </div>
      <p className='hint'>
        Khung rộng {observed.width}px, {observed.z} cột, mỗi cột {colWidth}px. Cột "chỉ nghe window.resize" không đổi khi bạn kéo khung: cửa sổ có đổi kích thước đâu.
      </p>
    </section>
  );
}

function DisplayModePanel() {
  const [mode, setMode] = useState<DisplayMode>(() => getDisplayMode());
  useEffect(() => watchDisplayMode(setMode), []);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return (
    <section className='card cbr-panel'>
      <h2>2. Đang chạy như PWA hay trong tab? (App Store web)</h2>
      <p className='hint'>
        getDisplayMode() = <b data-testid='display-mode'>{mode}</b>. Cài trang thành app (hoặc "Thêm vào màn hình chính" trên iOS) rồi mở lại để thấy giá trị khác.
      </p>
      <table className='cbr-table'>
        <tbody>
          {MODES.map((m) => (
            <tr key={m}>
              <td>
                <code>(display-mode: {m})</code>
              </td>
              <td>{matchMedia(`(display-mode: ${m})`).matches ? '✅ khớp' : '—'}</td>
            </tr>
          ))}
          <tr>
            <td>
              <code>navigator.standalone</code>
            </td>
            <td>{String(standalone)}</td>
          </tr>
          <tr>
            <td>
              <code>document.referrer</code>
            </td>
            <td>{document.referrer || '(rỗng)'}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export default function CssBridgeDemo() {
  return (
    <div className='page css-bridge-demo'>
      <h1>CSS nói, JS nghe: breakpoint và chế độ hiển thị</h1>
      <p className='hint'>Breakpoint chỉ khai báo một lần trong CSS; JS đọc lại qua z-index (Ello) hoặc custom property.</p>
      <BreakpointPanel />
      <DisplayModePanel />
    </div>
  );
}

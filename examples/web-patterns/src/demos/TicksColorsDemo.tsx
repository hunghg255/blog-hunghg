import { useEffect, useMemo, useRef, useState } from 'react';
import { buildTicks, chooseTickScale, formatTime } from '../lib/timelineTicks';
import { createColorPool } from '../lib/colorPool';
import { Stat } from './shared';
import './TicksColorsDemo.css';

// ---- Bản gốc của Anchor (rút gọn, giữ nguyên logic) để so sánh ----
function anchorTimeInterval(pxPerSec: number) {
  if (pxPerSec >= 25 * 100) return 0.01;
  if (pxPerSec >= 25 * 40) return 0.25;
  if (pxPerSec >= 25 * 10) return 0.1;
  if (pxPerSec >= 25 * 4) return 0.5;
  if (pxPerSec >= 25) return 1;
  if (pxPerSec * 5 >= 25) return 10;
  return Math.ceil(0.5 / pxPerSec) * 120;
}
function anchorPrimaryLabelInterval(pxPerSec: number) {
  if (pxPerSec >= 25 * 100) return 100;
  if (pxPerSec >= 25 * 40) return 4;
  if (pxPerSec >= 25 * 10) return 10;
  if (pxPerSec >= 25 * 4) return 40;
  if (pxPerSec * 5 >= 25) return 80;
  return Math.ceil(0.5 / pxPerSec) * 120;
}
function anchorFormatTime(seconds: number, pxPerSec: number) {
  let secondsNum = Number(seconds);
  const minutesNum = Math.floor(seconds / 60);
  secondsNum = secondsNum % 60;
  let secondsStr = Math.round(secondsNum).toString();
  if (pxPerSec >= 25 * 20) secondsStr = seconds.toFixed(2); // dùng tổng số giây, không phải phần dư
  if (secondsNum < 10) secondsStr = `0${secondsStr}`;
  const minutesStr = minutesNum < 10 ? `0${minutesNum}` : String(minutesNum);
  return `${minutesStr}:${secondsStr}`;
}

// ---- Bản gốc của Similarweb ----
class SimilarwebColorStack {
  private available: string[] = [];
  constructor(private colors: string[]) {
    this.reset();
  }
  reset() {
    this.available = [...this.colors];
  }
  acquire() {
    if (!this.available.length) this.reset();
    return this.available.shift()!;
  }
  release(color: string) {
    this.available.unshift(color);
  }
}

const DURATION = 3600; // podcast 1 giờ
const PALETTE = ['#4f8cff', '#ff8a3d', '#34d399', '#f472b6', '#facc15'];
const SITES = ['google.com', 'youtube.com', 'facebook.com', 'tiktok.com', 'wikipedia.org', 'reddit.com', 'github.com'];

/** Đường gấp khúc giả lập traffic, cố định theo tên site. */
function sparkline(name: string) {
  let seed = [...name].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  return Array.from({ length: 12 }, (_, i) => `${i * 20},${10 + rand() * 50}`).join(' ');
}

function Ruler({ width, pxPerSec, start }: { width: number; pxPerSec: number; start: number }) {
  const end = Math.min(DURATION, start + width / pxPerSec);
  const { ticks } = buildTicks(start, end, pxPerSec);
  return (
    <svg className='tc-ruler' width={width} height={44} role='img' aria-label='Thước thời gian bản viết lại'>
      {ticks.map((t) => (
        <g key={t.time}>
          <line x1={t.x} x2={t.x} y1={t.label ? 0 : 0} y2={t.label ? 18 : 8} />
          {t.label && (
            <text x={t.x + 3} y={32}>
              {t.label}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

function AnchorRuler({ width, pxPerSec, start }: { width: number; pxPerSec: number; start: number }) {
  const step = anchorTimeInterval(pxPerSec);
  const every = anchorPrimaryLabelInterval(pxPerSec);
  const end = Math.min(DURATION, start + width / pxPerSec);
  const items = [];
  // giới hạn số vạch vẽ ra để demo không treo khi zoom cực sâu
  for (let i = Math.ceil(start / step); i * step <= end && items.length < 2000; i++) {
    const x = (i * step - start) * pxPerSec;
    const primary = i % every === 0;
    items.push(
      <g key={i}>
        <line x1={x} x2={x} y1={0} y2={primary ? 18 : 8} />
        {primary && (
          <text x={x + 3} y={32}>
            {anchorFormatTime(i * step, pxPerSec)}
          </text>
        )}
      </g>,
    );
  }
  return (
    <svg className='tc-ruler anchor' width={width} height={44} role='img' aria-label='Thước thời gian theo bậc thang của Anchor'>
      {items}
    </svg>
  );
}

function TicksSection() {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [zoom, setZoom] = useState(55); // 0..100, thang log
  const [startPct, setStartPct] = useState(2);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 0 -> 0.05 px/s (cả giờ nằm gọn trong màn hình), 100 -> 3000 px/s (thấy từng 1/100 giây)
  const pxPerSec = 0.05 * Math.pow(3000 / 0.05, zoom / 100);
  const visible = width / pxPerSec;
  const start = Math.max(0, Math.min(DURATION - visible, (startPct / 100) * DURATION));

  const ours = chooseTickScale(pxPerSec);
  const anchorStep = anchorTimeInterval(pxPerSec);
  const anchorEvery = anchorPrimaryLabelInterval(pxPerSec);
  const anchorLabelPx = anchorStep * anchorEvery * pxPerSec;

  return (
    <section className='card tc-section'>
      <h2>Thước thời gian theo mức zoom</h2>
      <div className='toolbar'>
        <label>
          Zoom <input type='range' min={0} max={100} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
        </label>
        <label>
          Vị trí <input type='range' min={0} max={100} value={startPct} onChange={(e) => setStartPct(+e.target.value)} />
        </label>
      </div>
      <div className='stats'>
        <Stat label='px mỗi giây' value={pxPerSec < 1 ? pxPerSec.toFixed(2) : Math.round(pxPerSec)} />
        <Stat label='đang thấy' value={formatTime(Math.min(visible, DURATION), visible < 10 ? 2 : 0)} />
        <Stat label='bản viết lại: vạch / nhãn' value={`${ours.step}s / ${ours.labelStep}s`} />
        <Stat label='Anchor: khoảng cách 2 nhãn chính' value={`${Math.round(anchorLabelPx).toLocaleString('vi-VN')}px`} />
      </div>
      <div ref={boxRef} className='tc-rulers'>
        <p className='muted'>Bản viết lại (vạch đẹp + khoảng cách tối thiểu tính bằng px)</p>
        <Ruler width={width} pxPerSec={pxPerSec} start={start} />
        <p className='muted'>
          Bậc thang của Anchor, chỉ vẽ nhãn chính (vạch {anchorStep}s, nhãn mỗi {anchorEvery} vạch)
          {anchorLabelPx > width && <span className='warn'> — không có nhãn nào lọt vào khung</span>}
        </p>
        <AnchorRuler width={width} pxPerSec={pxPerSec} start={start} />
      </div>
      <p className='hint'>
        Định dạng ở mức zoom sâu: Anchor in <code>75.5s</code> thành <b className='err'>{anchorFormatTime(75.5, 600)}</b> và{' '}
        <code>65.5s</code> thành <b className='err'>{anchorFormatTime(65.5, 600)}</b>; bản viết lại in{' '}
        <b className='ok'>{formatTime(75.5, 2)}</b> và <b className='ok'>{formatTime(65.5, 2)}</b>.
      </p>
    </section>
  );
}

function ColorsSection() {
  const [selected, setSelected] = useState<string[]>([]);
  // hai bộ cấp màu chạy song song trên cùng một chuỗi thao tác
  const original = useMemo(() => new SimilarwebColorStack(PALETTE), []);
  const pool = useMemo(() => createColorPool(PALETTE), []);
  const [originalColors, setOriginalColors] = useState<Record<string, string>>({});
  const [, force] = useState(0);

  const toggle = (site: string) => {
    if (selected.includes(site)) {
      // giống MultiColorSelectionTable: bỏ chọn thì release màu, nhưng hàng vẫn giữ selectionColor
      original.release(originalColors[site]);
      pool.release(site);
      setSelected((s) => s.filter((x) => x !== site));
    } else {
      // chọn lại: `row.selectionColor ? row.selectionColor : acquire()` -> dùng lại màu cũ mà
      // KHÔNG lấy nó ra khỏi stack, nên màu đó vẫn nằm trong danh sách màu trống
      const color = originalColors[site] ?? original.acquire();
      setOriginalColors((c) => ({ ...c, [site]: color }));
      pool.acquire(site);
      setSelected((s) => [...s, site]);
    }
    force((n) => n + 1);
  };

  const resetAll = () => {
    original.reset();
    pool.reset();
    setOriginalColors({});
    setSelected([]);
  };

  const dupes = (colors: string[]) => colors.length - new Set(colors).size;
  const originalDupes = dupes(selected.map((s) => originalColors[s]));
  const poolDupes = dupes(selected.map((s) => pool.colorOf(s)!));

  const chart = (colorOf: (site: string) => string | undefined) => (
    <svg viewBox='0 0 220 70' className='tc-chart' role='img' aria-label='Biểu đồ traffic các site đã chọn'>
      {selected.map((site) => (
        <polyline key={site} points={sparkline(site)} stroke={colorOf(site)} />
      ))}
    </svg>
  );

  return (
    <section className='card tc-section'>
      <h2>Cấp màu cho series biểu đồ (palette {PALETTE.length} màu)</h2>
      <p className='hint'>
        Bấm chọn site để thêm series. Thử: chọn google, youtube, facebook, tiktok; bỏ chọn youtube rồi chọn lại; chọn thêm
        wikipedia. Chỉ 5 series với 5 màu, nhưng bản gốc cấp trùng màu.
      </p>
      <div className='toolbar tc-sites'>
        {SITES.map((site) => (
          <button key={site} aria-pressed={selected.includes(site)} className={selected.includes(site) ? 'primary' : ''} onClick={() => toggle(site)}>
            {site}
          </button>
        ))}
        <button onClick={resetAll}>Bỏ chọn hết</button>
      </div>
      <div className='split'>
        <div>
          <h3>
            ColorStack (bản gốc){' '}
            <span className={`badge ${originalDupes ? 'err' : 'ok'}`}>{originalDupes ? `${originalDupes} màu trùng` : 'không trùng'}</span>
          </h3>
          {chart((s) => originalColors[s])}
          <Legend sites={selected} colorOf={(s) => originalColors[s]} />
        </div>
        <div>
          <h3>
            createColorPool <span className={`badge ${poolDupes ? 'warn' : 'ok'}`}>{poolDupes ? `${poolDupes} màu trùng (hết màu)` : 'không trùng'}</span>
          </h3>
          {chart((s) => pool.colorOf(s))}
          <Legend sites={selected} colorOf={(s) => pool.colorOf(s)} />
        </div>
      </div>
    </section>
  );
}

function Legend({ sites, colorOf }: { sites: string[]; colorOf: (s: string) => string | undefined }) {
  return (
    <ul className='tc-legend'>
      {sites.map((s) => (
        <li key={s}>
          <i style={{ background: colorOf(s) }} /> {s}
        </li>
      ))}
    </ul>
  );
}

export default function TicksColorsDemo() {
  return (
    <div className='page tc-page'>
      <h1>Vạch thước theo zoom và cấp phát màu</h1>
      <TicksSection />
      <ColorsSection />
    </div>
  );
}

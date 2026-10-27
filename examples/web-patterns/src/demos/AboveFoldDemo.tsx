import { useEffect, useMemo, useRef, useState } from 'react';
import { measureAboveTheFold } from '../lib/aboveFoldTiming';
import { observeInputDelay, type InputDelayReport } from '../lib/aboveFoldInputDelay';
import { breakdown, latestEntry, type ResourceBreakdown } from '../lib/aboveFoldResourceTiming';
import { zapposSoftNav } from './AboveFoldZappos';
import { Log, sleep, useLog } from './shared';
import './AboveFoldDemo.css';

type Scenario = 'cached' | 'lazy' | 'none';
const SCENARIOS: Record<Scenario, string> = {
  cached: 'Ảnh có sẵn trong cache',
  lazy: 'Ảnh gán src sau 1.2–2s (lazy-load)',
  none: 'Trang không có ảnh',
};
const PRODUCTS = 6;
const API_MS = 300;

/** Ảnh sản phẩm vẽ bằng canvas, đổi sang data URL: không cần mạng. */
function useTiles() {
  return useMemo(
    () =>
      Array.from({ length: PRODUCTS }, (_, i) => {
        const canvas = document.createElement('canvas');
        canvas.width = 160;
        canvas.height = 120;
        const ctx = canvas.getContext('2d')!;
        ctx.fillStyle = `hsl(${i * 55}, 70%, 55%)`;
        ctx.fillRect(0, 0, 160, 120);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 40px system-ui, sans-serif';
        ctx.fillText(`#${i + 1}`, 52, 76);
        return canvas.toDataURL('image/png');
      }),
    [],
  );
}

interface Row {
  id: number;
  scenario: Scenario;
  truth?: number;
  zappos?: number | 'never';
  ours?: number;
}

const fmt = (v: number | 'never' | undefined) =>
  v === undefined ? '…' : v === 'never' ? 'không gửi' : `${Math.round(v)}ms`;

/** Bản BestBuy (viết lại cho demo): cộng 4 khoảng, không kiểm tra request có Timing-Allow-Origin hay không. */
function bestBuyTotal(e: Pick<PerformanceResourceTiming, 'domainLookupStart' | 'domainLookupEnd' | 'connectStart' | 'connectEnd' | 'requestStart' | 'responseStart' | 'responseEnd'>) {
  return (
    e.domainLookupEnd - e.domainLookupStart + (e.connectEnd - e.connectStart) + (e.responseStart - e.requestStart) + (e.responseEnd - e.responseStart)
  );
}

export default function AboveFoldDemo() {
  const tiles = useTiles();
  const rootRef = useRef<HTMLDivElement>(null);
  const [scenario, setScenario] = useState<Scenario>('lazy');
  const [route, setRoute] = useState<'home' | 'loading' | 'product'>('home');
  const [srcs, setSrcs] = useState<(string | undefined)[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const [delays, setDelays] = useState<InputDelayReport[]>([]);
  const [resource, setResource] = useState<{ ours: ResourceBreakdown; bestBuy: number } | null>(null);
  const { lines, add } = useLog();
  const navRef = useRef({ id: 0, t0: 0, loads: [] as number[], committedAt: 0 });

  useEffect(() => observeInputDelay((report) => setDelays((prev) => [report, ...prev].slice(0, 5)), { threshold: 30 }), []);

  const update = (id: number, patch: Partial<Row>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  async function navigate() {
    const root = rootRef.current!;
    const id = ++navRef.current.id;
    const t0 = performance.now();
    navRef.current = { id, t0, loads: [], committedAt: 0 };
    setRunning(true);
    setRows((prev) => [{ id, scenario }, ...prev].slice(0, 6));

    let zapposDone = false;
    const stopZappos = zapposSoftNav(root, (ms) => {
      zapposDone = true;
      update(id, { zappos: ms });
    });
    const measurement = measureAboveTheFold({ root, startedAt: t0, timeoutMs: 8000 });

    setRoute('loading');
    setSrcs([]);
    await sleep(API_MS); // gọi API lấy danh sách sản phẩm
    const initial = Array.from({ length: PRODUCTS }, (_, i) => (scenario === 'cached' ? tiles[i] : undefined));
    setSrcs(initial);
    setRoute('product');
    if (scenario === 'lazy') {
      tiles.forEach((tile, i) =>
        setTimeout(() => setSrcs((prev) => prev.map((s, j) => (j === i ? tile : s))), 1200 + i * 160),
      );
    }

    const result = await measurement.result;
    update(id, { ours: result.aboveTheFold });
    // "thực tế": đợi mọi ảnh tải xong (tối đa 5 giây) rồi lấy mốc muộn nhất
    for (let waited = 0; scenario !== 'none' && navRef.current.loads.length < PRODUCTS && waited < 5000; waited += 100) {
      await sleep(100);
    }
    const { loads, committedAt } = navRef.current;
    update(id, { truth: Math.max(committedAt, ...loads) - t0 });
    add(
      `${SCENARIOS[scenario]}: DOM yên lúc ${Math.round(result.domStableAt - t0)}ms, ${result.imageCount} ảnh xong lúc ${Math.round(result.imagesDoneAt - t0)}ms`,
      'ok',
    );
    await sleep(800);
    if (!zapposDone) update(id, { zappos: 'never' });
    stopZappos();
    setRunning(false);
  }

  useEffect(() => {
    if (route === 'product') navRef.current.committedAt = performance.now();
  }, [route]);

  function busy(ms: number) {
    add(`Main thread sẽ bận ${ms}ms, bấm nút "Bấm thử" ngay trong lúc đó`, 'muted');
    setTimeout(() => {
      const end = performance.now() + ms;
      while (performance.now() < end) {
        /* bận */
      }
    }, 300);
  }

  async function loadResource() {
    const url = new URL(`./index.html?probe=${Date.now()}`, location.href).href;
    // phải đọc hết body: entry Resource Timing chỉ được thêm khi response tải xong
    await (await fetch(url, { cache: 'no-store' })).text();
    await sleep(50);
    const entry = latestEntry(url);
    if (!entry) {
      add('Không tìm thấy entry Resource Timing', 'err');
      return;
    }
    setResource({ ours: breakdown(entry), bestBuy: bestBuyTotal(entry) });
  }

  function crossOriginNoTao() {
    // Các mốc của một request khác origin KHÔNG có Timing-Allow-Origin: chỉ startTime, duration, responseEnd có giá trị
    const responseEnd = performance.now();
    const fake = {
      name: 'https://api.example.com/products',
      duration: 182,
      domainLookupStart: 0,
      domainLookupEnd: 0,
      connectStart: 0,
      connectEnd: 0,
      secureConnectionStart: 0,
      requestStart: 0,
      responseStart: 0,
      responseEnd,
    } as PerformanceResourceTiming;
    setResource({ ours: breakdown(fake), bestBuy: bestBuyTotal(fake) });
  }

  return (
    <div className='page af'>
      <h1>Đo phần đầu màn hình hiển thị xong</h1>
      <p className='hint'>
        Mỗi lần bấm "Chuyển trang": gọi API giả 300ms rồi render 6 ảnh. Cột "thực tế" lấy từ sự kiện load của từng ảnh. So
        với cách Zappos đo (chờ DOM yên 1 giây rồi trừ đi 1 giây) và bản viết lại.
      </p>
      <div className='toolbar'>
        {(Object.keys(SCENARIOS) as Scenario[]).map((key) => (
          <button key={key} className={scenario === key ? 'primary' : ''} onClick={() => setScenario(key)} disabled={running}>
            {SCENARIOS[key]}
          </button>
        ))}
        <button className='primary' onClick={navigate} disabled={running}>
          → Chuyển trang
        </button>
      </div>

      <div ref={rootRef} className='af-app card'>
        {route === 'home' && <p className='muted'>Trang chủ. Bấm "Chuyển trang".</p>}
        {route === 'loading' && <div className='skeleton af-skeleton' />}
        {route === 'product' && (
          <div className='af-grid'>
            {Array.from({ length: PRODUCTS }, (_, i) =>
              scenario === 'none' ? (
                <div key={i} className='af-text'>
                  Sản phẩm #{i + 1}
                </div>
              ) : (
                <img
                  key={i}
                  src={srcs[i]}
                  alt={`Sản phẩm ${i + 1}`}
                  width={160}
                  height={120}
                  onLoad={() => navRef.current.loads.push(performance.now())}
                />
              ),
            )}
          </div>
        )}
      </div>

      <table className='af-table'>
        <thead>
          <tr>
            <th>Tình huống</th>
            <th>Thực tế</th>
            <th>Kiểu Zappos</th>
            <th>Bản viết lại</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{SCENARIOS[row.scenario]}</td>
              <td>{fmt(row.truth)}</td>
              <td className={typeof row.zappos === 'number' && row.truth !== undefined && Math.abs(row.zappos - row.truth) > 150 ? 'err' : row.zappos === 'never' ? 'err' : ''}>
                {fmt(row.zappos)}
              </td>
              <td className='ok'>{fmt(row.ours)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className='card af-section'>
        <h2>Độ trễ khi bấm (Outlook)</h2>
        <div className='toolbar'>
          <button onClick={() => busy(800)}>Làm main thread bận 800ms</button>
          <button className='primary'>Bấm thử</button>
        </div>
        {delays.length === 0 ? (
          <p className='muted'>Chưa có lần bấm nào trễ quá 30ms.</p>
        ) : (
          <ul className='af-delays'>
            {delays.map((d) => (
              <li key={d.at} className={d.delay > 200 ? 'err' : 'warn'}>
                {d.type}: trễ {Math.round(d.delay)}ms
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className='card af-section'>
        <h2>Tách thời gian một request (Best Buy)</h2>
        <div className='toolbar'>
          <button onClick={loadResource}>Tải 1 file cùng origin</button>
          <button onClick={crossOriginNoTao}>Request khác origin, không có Timing-Allow-Origin</button>
        </div>
        {resource && (
          <div className='af-resource'>
            <code>{resource.ours.url}</code>
            {resource.ours.detailed ? (
              <p>
                DNS {resource.ours.dns!.toFixed(1)} · kết nối {resource.ours.connect!.toFixed(1)} · chờ server{' '}
                {resource.ours.waiting!.toFixed(1)} · tải {resource.ours.download!.toFixed(1)} · tổng{' '}
                {resource.ours.total.toFixed(1)}ms
              </p>
            ) : (
              <p className='warn'>Không có chi tiết, chỉ biết tổng {resource.ours.total.toFixed(0)}ms.</p>
            )}
            <p className={Math.abs(resource.bestBuy - resource.ours.total) > 50 ? 'err' : 'muted'}>
              Công thức Best Buy: {resource.bestBuy.toFixed(1)}ms
            </p>
          </div>
        )}
      </section>

      <Log lines={lines} />
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { createFpsMonitor, createIdleMonitor, framesWithFreeze, simulateIdle, windowedFps, type IdleMode } from '../lib/waFpsMonitor';
import { Log, Stat, useLog } from './shared';
import './WaFpsMonitorDemo.css';

const block = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* chặn main thread */
  }
};

// ---------------------------------------------------------------------------
// 1. Đo thật trên tab này

function LiveFps() {
  const [fps, setFps] = useState(60);
  const [hits, setHits] = useState({ t50: 0, t30: 0, t1: 0, long: 0 });
  const { lines, add } = useLog(10);

  useEffect(() => {
    const m = createFpsMonitor({ pauseOnBlur: false });
    const bump = (k: keyof typeof hits) => setHits((h) => ({ ...h, [k]: h[k] + 1 }));
    const offs = [
      m.whenLessThan(50, (f) => (bump('t50'), add(`FPS trung bình ${f.toFixed(1)} < 50`))),
      m.whenLessThan(30, (f) => (bump('t30'), add(`FPS trung bình ${f.toFixed(1)} < 30`, 'warn'))),
      m.whenLessThan(1, (f) => (bump('t1'), add(`FPS trung bình ${f.toFixed(2)} < 1 → kiểu WhatsApp báo "UI đóng băng"`, 'err'))),
      m.onLongFrame((gap) => (bump('long'), add(`một khung dài ${Math.round(gap)} ms → bản viết lại báo đóng băng`, 'err'))),
    ];
    const id = setInterval(() => setFps(m.fps), 250);
    return () => (offs.forEach((off) => off()), clearInterval(id));
  }, [add]);

  return (
    <section className='card wfp-card'>
      <h2>1. Đo FPS thật trên tab này</h2>
      <p className='hint'>
        Mỗi nút chặn main thread một khoảng. FPS được tính trung bình theo cửa sổ ≥ 500 ms như bản gốc; ngưỡng &lt; 1 là ngưỡng WhatsApp dùng để
        ghi sự kiện "UI freeze". Bấm "Chặn 1,2 s" vài lần: ngưỡng &lt; 1 gần như không bao giờ bắt được.
      </p>
      <div className='toolbar'>
        <button onClick={() => block(150)}>Chặn 150 ms</button>
        <button className='primary' onClick={() => block(1200)}>
          Chặn 1,2 s
        </button>
        <button
          onClick={() => {
            let n = 0;
            const id = setInterval(() => (block(60), ++n === 20 && clearInterval(id)), 70);
          }}
        >
          Giật: 20 × 60 ms
        </button>
      </div>
      <div className='stats'>
        <Stat label='FPS (trung bình cửa sổ)' value={fps.toFixed(1)} />
        <Stat label='< 50' value={hits.t50} />
        <Stat label='< 30' value={hits.t30} />
        <Stat label='< 1 (WhatsApp)' value={hits.t1} />
        <Stat label='khung ≥ 1 s (viết lại)' value={hits.long} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Mô phỏng: có bắt được đóng băng hay không phụ thuộc pha của cửa sổ

const CELLS = 50;

/** Đứng hình bắt đầu lệch `offset` ms so với ranh giới cửa sổ: FPS trung bình thấp nhất là bao nhiêu? */
const minFpsAt = (offset: number, freeze: number) =>
  Math.min(...windowedFps(framesWithFreeze(1000 + freeze + 2000, 1000 + offset, freeze)).map((r) => r.fps));

function PhaseSim() {
  const [freeze, setFreeze] = useState(1200);
  const { cells, rate } = useMemo(() => {
    const mins = Array.from({ length: 500 }, (_, ms) => minFpsAt(ms, freeze));
    return {
      cells: Array.from({ length: CELLS }, (_, i) => mins.slice(i * 10, i * 10 + 10).some((m) => m < 1)),
      rate: mins.filter((m) => m < 1).length / mins.length,
    };
  }, [freeze]);

  return (
    <section className='card wfp-card'>
      <h2>2. Cùng một lần đứng hình, lúc bắt được lúc không</h2>
      <p className='hint'>
        Mô phỏng 500 lần đứng hình dài như nhau, lần thứ k bắt đầu lệch k ms so với ranh giới cửa sổ 500 ms. Mỗi ô là 10 ms lệch pha; ô xanh: có
        lần FPS trung bình xuống dưới 1 (bắt được). Đo độ dài từng khung (bản viết lại) thì bắt được mọi lần đứng hình ≥ 1 s.
      </p>
      <div className='toolbar'>
        <label>
          Đứng hình <input type='range' min={600} max={3000} step={100} value={freeze} onChange={(e) => setFreeze(+e.target.value)} />{' '}
          <b>{freeze} ms</b>
        </label>
      </div>
      <div className='wfp-phases'>
        {cells.map((hit, i) => (
          <i key={i} className={hit ? 'hit' : ''} title={`lệch ${i * 10}–${i * 10 + 9} ms`} />
        ))}
      </div>
      <div className='stats'>
        <Stat label='WhatsApp (FPS < 1) bắt được' value={`${(rate * 100).toFixed(1)}%`} />
        <Stat label='đo độ dài khung bắt được' value={freeze >= 1000 ? '100%' : '0% (ngắn hơn 1 s)'} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Idle monitor

const IDLE = 60;
const GRACE = 30;
const END = 300;
const SCENARIOS: Record<string, number[]> = {
  'rời đi ngay sau mốc 60 s': [10, 20, 30, 40, 50, 61],
  'rời đi ngay trước mốc 120 s': [10, 30, 50, 61, 80, 100, 119],
  'quay lại ở giây 200': [10, 30, 50, 200, 210],
};

function IdleSim() {
  const [name, setName] = useState(Object.keys(SCENARIOS)[0]);
  const activity = SCENARIOS[name];
  const left = Math.max(...activity.filter((a) => a < 150));
  const modes: [IdleMode, string][] = [
    ['periodic', 'kiểu WhatsApp (chu kỳ)'],
    ['since-last-activity', 'từ hoạt động cuối'],
  ];
  const [liveIdle, setLiveIdle] = useState(false);
  useEffect(() => createIdleMonitor(5000, setLiveIdle), []);

  const pct = (t: number) => `${(t / END) * 100}%`;
  return (
    <section className='card wfp-card'>
      <h2>3. Khi nào coi là "rời máy"?</h2>
      <p className='hint'>
        Bản gốc: cứ hết <code>IDLE_TIMEOUT</code> mới bắt đầu nghe chuột/phím; hoạt động trong lúc chờ không tính. Demo giả định IDLE = {IDLE} s,
        thêm {GRACE} s trễ trước khi gửi "unavailable" (giá trị thật nằm ở module không có trong bundle).
      </p>
      <div className='toolbar'>
        {Object.keys(SCENARIOS).map((k) => (
          <button key={k} className={k === name ? 'primary' : ''} onClick={() => setName(k)}>
            {k}
          </button>
        ))}
      </div>
      {modes.map(([mode, label]) => {
        const spans = simulateIdle(activity, END, IDLE, GRACE, mode);
        const firstAway = spans.find(([from]) => from > left)?.[0];
        return (
          <div key={mode} className='wfp-row'>
            <span>{label}</span>
            <div>
              {spans.map(([a, b]) => (
                <b key={a} style={{ left: pct(a), width: pct(b - a) }} />
              ))}
              {activity.map((a) => (
                <i key={a} style={{ left: pct(a) }} />
              ))}
            </div>
            <small>{firstAway !== undefined ? `away sau ${firstAway - left} s` : '—'}</small>
          </div>
        );
      })}
      <p className='hint wfp-legend'>Vạch nhỏ: hoạt động. Dải màu: bị đánh dấu unavailable. Trục: 0–{END} s.</p>
      <div className='stats'>
        <Stat label='idle monitor thật (5 s, từ hoạt động cuối)' value={liveIdle ? 'rảnh' : 'đang dùng'} />
      </div>
    </section>
  );
}

export default function WaFpsMonitorDemo() {
  return (
    <div className='page wfp-page'>
      <h1>Đo FPS phát hiện UI đóng băng, idle monitor</h1>
      <p className='hint'>Viết lại từ WhatsApp Web 2020 (module ihgefacbb, chgfegiddc).</p>
      <LiveFps />
      <PhaseSim />
      <IdleSim />
    </div>
  );
}

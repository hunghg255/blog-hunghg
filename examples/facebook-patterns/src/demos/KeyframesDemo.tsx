import { useEffect, useMemo, useRef, useState } from 'react';
import { CubicBezier, createLoop, loopConfig, loopStats, simulateBackground, tween, type LoopHandle } from '../lib/keyframes';
import { fbLoopStats, fbReset, fbStart } from './keyframesFbStyle';
import { Log, Stat, useLog } from './shared';
import './KeyframesDemo.css';

const SPINNERS = 24;

/** Phần 1: 24 spinner, mỗi cái tự gọi rAF hoặc dùng chung một vòng. */
function SpinnerFarm({ log }: { log: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [mode, setMode] = useState<'shared' | 'own' | 'fb'>('shared');
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  const [perSecond, setPerSecond] = useState(0);
  const [alive, setAlive] = useState(true);
  const crashRef = useRef(false);

  useEffect(() => {
    crashRef.current = false;
    setAlive(true);
    const angles = new Array(SPINNERS).fill(0);
    let rafCalls = 0;
    const draw = (i: number, delta: number) => {
      if (crashRef.current && i === 5) throw new Error('spinner #5 hỏng dữ liệu');
      angles[i] = (angles[i] + delta * 0.36) % 360;
      const el = refs.current[i];
      if (el) el.style.transform = `rotate(${angles[i]}deg)`;
    };

    const cleanups: Array<() => void> = [];
    if (mode === 'own') {
      // cách ngây thơ: mỗi animation một vòng rAF riêng
      for (let i = 0; i < SPINNERS; i++) {
        let prev = performance.now();
        let id = 0;
        const frame = (now: number) => {
          rafCalls++;
          try {
            draw(i, now - prev);
          } catch {
            return; // chỉ spinner này dừng
          }
          prev = now;
          id = requestAnimationFrame(frame);
        };
        id = requestAnimationFrame(frame);
        cleanups.push(() => cancelAnimationFrame(id));
      }
    } else if (mode === 'fb') {
      fbReset();
      for (let i = 0; i < SPINNERS; i++) cleanups.push(fbStart((d) => (i === 0 && rafCalls++, draw(i, d))));
    } else {
      loopConfig.onError = (e) => log(`Vòng chung bắt được lỗi: ${(e as Error).message}, các spinner khác chạy tiếp`, 'warn');
      const before = loopStats.rafCallbacks;
      const handles: LoopHandle[] = [];
      for (let i = 0; i < SPINNERS; i++) {
        const h = createLoop((d) => draw(i, d));
        h.start();
        handles.push(h);
      }
      cleanups.push(() => handles.forEach((h) => h.cancel()));
      const sync = setInterval(() => (rafCalls = loopStats.rafCallbacks - before), 100);
      cleanups.push(() => clearInterval(sync));
    }

    let last = 0;
    const meter = setInterval(() => {
      setPerSecond(rafCalls - last);
      last = rafCalls;
      if (mode === 'fb' && fbLoopStats.stopped) setAlive(false);
    }, 1000);
    return () => {
      clearInterval(meter);
      cleanups.forEach((c) => c());
      fbReset();
    };
  }, [mode, log]);

  return (
    <section className='card'>
      <h3>1. Một vòng rAF cho mọi animation</h3>
      <div className='toolbar' role='group' aria-label='Cách chạy spinner'>
        <button className={mode === 'own' ? 'primary' : ''} onClick={() => setMode('own')}>
          Mỗi spinner một rAF
        </button>
        <button className={mode === 'fb' ? 'primary' : ''} onClick={() => setMode('fb')}>
          Vòng chung kiểu bản gốc
        </button>
        <button className={mode === 'shared' ? 'primary' : ''} onClick={() => setMode('shared')}>
          Vòng chung bản viết lại
        </button>
        <button
          onClick={() => {
            crashRef.current = true;
            log(`Làm spinner #5 ném lỗi (chế độ: ${mode})`, 'err');
          }}
        >
          Cho spinner #5 ném lỗi
        </button>
      </div>
      <div className='stats'>
        <Stat label={mode === 'fb' ? 'vòng lặp / giây' : 'callback rAF / giây'} value={perSecond} />
        <Stat label='trạng thái' value={mode === 'fb' && !alive ? 'ĐỨNG HÌNH' : 'đang chạy'} />
      </div>
      <div className='kf-farm' data-testid='farm'>
        {Array.from({ length: SPINNERS }, (_, i) => (
          <div key={i} className='kf-spinner' ref={(el) => void (refs.current[i] = el)} />
        ))}
      </div>
    </section>
  );
}

const CURVES: Array<{ name: string; p: [number, number, number, number] }> = [
  { name: 'ease', p: [0.25, 0.1, 0.25, 1] },
  { name: 'ease-in-out', p: [0.42, 0, 0.58, 1] },
  { name: 'dốc (0.9,0,0.1,1)', p: [0.9, 0, 0.1, 1] },
  { name: 'dựng đứng (1,0,0,1)', p: [1, 0, 0, 1] },
];

/** Phần 2: sai số của solver theo epsilon, đo trên 1001 điểm so với nghiệm phân đôi 60 vòng. */
function SolverTable() {
  const rows = useMemo(
    () =>
      CURVES.map(({ name, p }) => {
        const curve = new CubicBezier([p[0], p[1]], [p[2], p[3]]);
        let fb = 0;
        let ours = 0;
        for (let k = 0; k <= 1000; k++) {
          const x = k / 1000;
          const exact = curve.solve(x, 1e-12);
          fb = Math.max(fb, Math.abs(curve.solve(x, 0.005) - exact));
          ours = Math.max(ours, Math.abs(curve.solve(x) - exact));
        }
        return { name, fb, ours };
      }),
    [],
  );
  return (
    <section className='card'>
      <h3>2. Sai số solver cubic-bezier</h3>
      <div className='kf-table-wrap'>
        <table className='kf-table' data-testid='solver-table'>
          <thead>
            <tr>
              <th>Đường cong</th>
              <th>ε = 0.005 (bản gốc)</th>
              <th>ε = 1e-4</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <td>{r.name}</td>
                <td className={r.fb > 0.02 ? 'err' : ''}>{r.fb.toFixed(4)}</td>
                <td>{r.ours.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** Phần 3: so easing JS với transition CSS cùng tham số, và giả lập tab nằm nền. */
function TweenRace() {
  const jsBox = useRef<HTMLDivElement>(null);
  const [cssOn, setCssOn] = useState(false);
  const [curve, setCurve] = useState(0);
  const handle = useRef<LoopHandle | null>(null);
  const p = CURVES[curve].p;

  const run = () => {
    handle.current?.cancel();
    setCssOn(false);
    requestAnimationFrame(() => requestAnimationFrame(() => setCssOn(true)));
    const solver = new CubicBezier([p[0], p[1]], [p[2], p[3]]);
    handle.current = tween(3000, (x) => solver.solve(x), (v) => {
      if (jsBox.current) jsBox.current.style.transform = `translateX(calc(${v} * (100cqw - 40px)))`;
    });
  };

  return (
    <section className='card'>
      <h3>3. Easing JS cạnh transition CSS</h3>
      <div className='toolbar'>
        <select value={curve} onChange={(e) => setCurve(Number(e.target.value))} aria-label='Đường cong'>
          {CURVES.map((c, i) => (
            <option key={c.name} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <button className='primary' onClick={run}>
          Chạy
        </button>
        <button onClick={() => simulateBackground(5000)}>Giả lập tab nằm nền 5 giây</button>
      </div>
      <div className='kf-track'>
        <div ref={jsBox} className='kf-box js'>
          JS
        </div>
      </div>
      <div className='kf-track'>
        <div
          className='kf-box css'
          style={{
            transform: cssOn ? 'translateX(calc(100cqw - 40px))' : 'none',
            transition: cssOn ? `transform 3000ms cubic-bezier(${p.join(',')})` : 'none',
          }}
        >
          CSS
        </div>
      </div>
      <p className='hint'>
        Bấm "Giả lập tab nằm nền" trong lúc đang chạy: delta của frame kế tiếp bị kẹp ở 1000ms nên hộp
        JS chỉ nhảy thêm 1 giây (một phần ba quãng đường), không nhảy thẳng về đích.
      </p>
    </section>
  );
}

export default function KeyframesDemo() {
  const { lines, add } = useLog(20);
  return (
    <div className='page'>
      <h1>Engine animation bằng JS</h1>
      <p className='hint'>Một vòng rAF dùng chung, kẹp delta, và solver cubic-bezier tự viết.</p>
      <SpinnerFarm log={add} />
      <SolverTable />
      <TweenRace />
      <Log lines={lines} />
    </div>
  );
}

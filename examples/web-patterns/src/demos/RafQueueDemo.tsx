import { useEffect, useRef, useState } from 'react';
import { RafQueue } from '../lib/rafQueue';
import { Log, Stat, useLog } from './shared';
import './RafQueueDemo.css';

const CELLS = 400;

/** Giả lập một việc tốn ~ms mili giây (đo layout, tính toán…) bằng vòng lặp bận. */
function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* bận */
  }
}

type Mode = 'all' | 'queue' | 'queue-throw';

/** Theo dõi độ dài từng frame bằng một vòng rAF riêng. */
function useFrameMonitor() {
  const [stats, setStats] = useState({ longest: 0, janky: 0 });
  const ref = useRef({ last: 0, longest: 0, janky: 0, active: false });
  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      const s = ref.current;
      if (s.active && s.last) {
        const d = t - s.last;
        if (d > s.longest) s.longest = d;
        if (d > 50) s.janky++;
      }
      s.last = t;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    const timer = setInterval(() => setStats({ longest: Math.round(ref.current.longest), janky: ref.current.janky }), 200);
    return () => {
      cancelAnimationFrame(id);
      clearInterval(timer);
    };
  }, []);
  const start = () => Object.assign(ref.current, { longest: 0, janky: 0, active: true });
  const stop = () => (ref.current.active = false);
  return { stats, start, stop };
}

export default function RafQueueDemo() {
  const gridRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLDivElement>(null);
  const [cost, setCost] = useState(0.5);
  const [result, setResult] = useState<{ ms: number; frames: number } | null>(null);
  const [running, setRunning] = useState(false);
  const { lines, add } = useLog();
  const monitor = useFrameMonitor();

  // Quả bóng chạy bằng JS trên main thread: frame nào bị chặn là thấy nó khựng
  useEffect(() => {
    let id = 0;
    const loop = (t: number) => {
      if (ballRef.current) ballRef.current.style.transform = `translateX(${(Math.sin(t / 300) + 1) * 45}%)`;
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  function reset() {
    gridRef.current?.querySelectorAll('.rq-cell').forEach((c) => c.classList.remove('on'));
  }

  function run(mode: Mode) {
    reset();
    const cells = Array.from(gridRef.current!.querySelectorAll<HTMLElement>('.rq-cell'));
    const t0 = performance.now();
    let frames = 0;
    monitor.start();
    setRunning(true);
    const finish = () => {
      const ms = Math.round(performance.now() - t0);
      setResult({ ms, frames });
      setRunning(false);
      setTimeout(monitor.stop, 100);
      add(
        `${mode === 'all' ? 'Tất cả trong 1 frame' : 'RafQueue 3ms'}: ${CELLS} task × ${cost}ms xong sau ${ms}ms, ${frames} frame`,
        mode === 'all' ? 'warn' : 'ok',
      );
    };

    const task = (cell: HTMLElement, i: number) => () => {
      if (mode === 'queue-throw' && i === 20) throw new Error('task #20 lỗi');
      busy(cost);
      cell.classList.add('on');
    };

    if (mode === 'all') {
      // Cách ngây thơ: một rAF chạy hết mọi việc
      requestAnimationFrame(() => {
        frames = 1;
        cells.forEach((cell, i) => task(cell, i)());
        finish();
      });
      return;
    }

    let done = 0;
    const queue = new RafQueue({
      budgetMs: 3,
      onFrame: ({ ran }) => {
        frames++;
        done += ran;
        if (done >= CELLS) finish();
      },
      onError: (e) => add(`Lỗi được cô lập: ${(e as Error).message}, các task khác vẫn chạy`, 'err'),
    });
    cells.forEach((cell, i) => queue.add(task(cell, i)));
  }

  return (
    <div className='page'>
      <h1>Hàng đợi rAF 3ms</h1>
      <p className='hint'>
        {CELLS} ô, mỗi ô cần một việc tốn {cost}ms khi "hiện ra". Chạy hết trong một frame thì quả bóng khựng lại; chia qua
        RafQueue thì việc vẫn xong mà bóng vẫn chạy đều.
      </p>
      <div className='toolbar'>
        <button disabled={running} onClick={() => run('all')}>
          Chạy hết trong 1 frame
        </button>
        <button disabled={running} className='primary' onClick={() => run('queue')}>
          Chạy qua RafQueue (3ms/frame)
        </button>
        <button disabled={running} onClick={() => run('queue-throw')}>
          RafQueue + 1 task ném lỗi
        </button>
        <label className='rq-cost'>
          mỗi task
          <select value={cost} onChange={(e) => setCost(Number(e.target.value))}>
            {[0.1, 0.5, 1, 5].map((v) => (
              <option key={v} value={v}>
                {v}ms
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className='rq-track'>
        <div className='rq-ball' ref={ballRef} />
      </div>
      <div className='stats'>
        <Stat label='tổng thời gian' value={result ? `${result.ms}ms` : '–'} />
        <Stat label='số frame' value={result?.frames ?? '–'} />
        <Stat label='frame dài nhất' value={`${monitor.stats.longest}ms`} />
        <Stat label='frame > 50ms' value={monitor.stats.janky} />
      </div>
      <div className='rq-grid' ref={gridRef}>
        {Array.from({ length: CELLS }, (_, i) => (
          <div key={i} className='rq-cell' />
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

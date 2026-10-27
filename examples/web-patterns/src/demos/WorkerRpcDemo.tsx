import { useEffect, useRef, useState } from 'react';
import { createWorkerClient, type WorkerClient } from '../lib/workerRpc';
import type { DemoWorkerApi } from '../lib/workerRpc.worker';
import { Log, Stat, useLog } from './shared';
import './WorkerRpcDemo.css';

const LIMIT = 5_000_000;

const makeWorker = () => new Worker(new URL('../lib/workerRpc.worker.ts', import.meta.url), { type: 'module' });

function countPrimesOnMainThread(limit: number) {
  let count = 0;
  for (let n = 2; n <= limit; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        prime = false;
        break;
      }
    }
    if (prime) count++;
  }
  return count;
}

/** Ô vuông chạy bằng rAF + đo khung hình dài nhất: main thread bị chặn là thấy ngay. */
function JankMeter() {
  const box = useRef<HTMLDivElement>(null);
  const [worst, setWorst] = useState(0);
  useEffect(() => {
    let id = 0;
    let last = performance.now();
    let lastReport = last;
    const gaps: Array<[number, number]> = []; // [thời điểm, độ dài khung] của các khung > 1 frame
    const loop = (t: number) => {
      if (t - last > 20) gaps.push([t, t - last]);
      last = t;
      if (box.current) box.current.style.transform = `translateX(${(Math.sin(t / 300) + 1) * 45}%)`;
      if (t - lastReport > 250) {
        while (gaps.length && gaps[0][0] < t - 5000) gaps.shift();
        setWorst(Math.round(Math.max(16, ...gaps.map(([, g]) => g))));
        lastReport = t;
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div className='rpc-jank'>
      <div className='rpc-lane'>
        <div ref={box} className='rpc-box' />
      </div>
      <span className={worst > 100 ? 'err' : 'ok'}>
        khung hình dài nhất (5s gần nhất): <b data-testid='worst-frame'>{worst}ms</b>
      </span>
    </div>
  );
}

export default function WorkerRpcDemo() {
  const client = useRef<WorkerClient<DemoWorkerApi> | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [generation, setGeneration] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const log = useLog();

  useEffect(() => {
    const c = createWorkerClient<DemoWorkerApi>(makeWorker());
    client.current = c;
    return () => c.terminate();
  }, [generation]);

  const timed = async (label: string, fn: () => Promise<unknown>) => {
    const t = performance.now();
    try {
      const result = await fn();
      log.add(`${label}: ${result} (${Math.round(performance.now() - t)}ms)`, 'ok');
    } catch (e) {
      const err = e as Error;
      log.add(`${label}: ${err.name}: ${err.message} (${Math.round(performance.now() - t)}ms)`, err.name === 'AbortError' ? 'warn' : 'err');
    }
  };

  const onMain = () => {
    log.add('đếm trên main thread… (ô vuông sẽ đứng hình)', 'muted');
    // setTimeout để log kịp vẽ trước khi main thread bị chặn
    setTimeout(() => {
      const t = performance.now();
      const n = countPrimesOnMainThread(LIMIT);
      log.add(`main thread: ${n} số nguyên tố (${Math.round(performance.now() - t)}ms, giao diện đứng suốt)`, 'err');
    }, 30);
  };

  const inWorker = async (method: 'countPrimes' | 'countPrimesBlocking') => {
    abort.current = new AbortController();
    setBusy(true);
    setProgress(0);
    await timed(method === 'countPrimes' ? 'worker' : 'worker (không nhường)', () =>
      client.current!.call(method, { limit: LIMIT }, { onProgress: setProgress, signal: abort.current!.signal }).then((n) => `${n} số nguyên tố`),
    );
    setBusy(false);
  };

  const ping = () =>
    timed('ping (countPrimes limit=10) xếp hàng sau việc đang chạy', () =>
      client.current!.call('countPrimes', { limit: 10 }).then((n) => `${n}`),
    );

  const transfer = () =>
    timed('nhận 64MB bằng transfer', () => client.current!.call('makeBuffer', { mb: 64 }).then((b) => `${b.byteLength / 1024 / 1024}MB`));

  const crash = async () => {
    await timed('worker sập', () => client.current!.call('crash', undefined as never));
    log.add('tạo worker mới', 'muted');
    setGeneration((g) => g + 1);
  };

  return (
    <div className='page'>
      <h1>Gọi Web Worker như một hàm async</h1>
      <p className='hint'>
        Promise + tiến độ + huỷ qua postMessage, theo cách của Telegram Web. Để ý ô vuông: nó chỉ đứng
        hình khi việc nặng chạy trên main thread.
      </p>
      <JankMeter />

      <div className='toolbar'>
        <button onClick={onMain}>Đếm trên main thread</button>
        <button className='primary' disabled={busy} onClick={() => inWorker('countPrimes')}>
          Đếm trong worker
        </button>
        <button disabled={busy} onClick={() => inWorker('countPrimesBlocking')}>
          Worker không nhường event loop
        </button>
        <button disabled={!busy} onClick={() => abort.current?.abort(new DOMException('người dùng huỷ', 'AbortError'))}>
          Huỷ
        </button>
      </div>
      <div className='rpc-progress' role='progressbar' aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <div className='toolbar'>
        <button onClick={ping}>Gọi thêm 1 việc nhỏ</button>
        <button onClick={transfer}>Nhận 64MB (transfer)</button>
        <button onClick={() => timed('hàm lỗi', () => client.current!.call('fail', undefined as never))}>Hàm ném lỗi</button>
        <button onClick={crash}>Worker sập</button>
      </div>
      <div className='stats'>
        <Stat label='tiến độ' value={`${Math.round(progress * 100)}%`} />
        <Stat label='worker #' value={generation + 1} />
      </div>
      <Log lines={log.lines} />
    </div>
  );
}

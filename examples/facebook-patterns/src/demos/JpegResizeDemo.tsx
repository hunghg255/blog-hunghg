import { useEffect, useRef, useState } from 'react';
import { WorkerPool, type DispatchStrategy } from '../lib/workerPool';
import { fitWithin, RESIZE_PRESETS, type ResizeJob, type ResizeResult } from '../lib/imageResize';
import { Log, Stat, useLog } from './shared';
import './JpegResizeDemo.css';

// Kích thước ảnh mẫu: lẫn ảnh to, ảnh rất to và ảnh đã nhỏ (sẽ được bỏ qua)
const SAMPLE_SIZES: Array<[number, number]> = [
  [4032, 3024],
  [6000, 4000],
  [3000, 2000],
  [800, 600],
  [4032, 3024],
  [2400, 3200],
  [6000, 4000],
  [1200, 900],
  [4032, 3024],
];

async function makeSample(width: number, height: number, seed: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, `hsl(${(seed * 47) % 360} 70% 55%)`);
  gradient.addColorStop(1, `hsl(${(seed * 47 + 140) % 360} 70% 35%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `hsla(${(seed * 31 + i * 23) % 360} 80% 70% / 0.5)`;
    const r = (Math.min(width, height) / 12) * (1 + (i % 4));
    ctx.beginPath();
    ctx.arc(((i * 97) % 100) / 100 * width, ((i * 53) % 100) / 100 * height, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
}

/** Cách "ngây thơ" hay gặp: <img> + canvas + toDataURL, tất cả trên main thread. */
async function resizeOnMainThread(job: ResizeJob): Promise<ResizeResult> {
  const start = performance.now();
  const url = URL.createObjectURL(job.blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  URL.revokeObjectURL(url);
  const target = fitWithin(img.naturalWidth, img.naturalHeight, job.maxWidth, job.maxHeight);
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0, target.width, target.height);
  const dataUrl = canvas.toDataURL('image/jpeg', job.quality); // mã hoá đồng bộ: chặn main thread
  const blob = await (await fetch(dataUrl)).blob();
  return {
    blob,
    skipped: target.scale === 1,
    originalWidth: img.naturalWidth,
    originalHeight: img.naturalHeight,
    outputWidth: target.width,
    outputHeight: target.height,
    ms: performance.now() - start,
  };
}

type Mode = 'main' | 'pool';

interface Row {
  id: number;
  worker: number | null;
  input: string;
  output?: string;
  ms?: number;
  status: 'chờ' | 'xong' | 'bỏ qua' | 'lỗi';
}

const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;

/** Đo frame dài nhất bằng vòng rAF, đồng thời chạy một chấm tròn để thấy giật. */
function useFrameMeter() {
  const dotRef = useRef<HTMLDivElement>(null);
  const worstRef = useRef(0);
  const [worst, setWorst] = useState(0);
  useEffect(() => {
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      worstRef.current = Math.max(worstRef.current, now - last);
      last = now;
      if (dotRef.current) dotRef.current.style.transform = `translateX(${((now / 4) % 220).toFixed(1)}px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const id = setInterval(() => setWorst(Math.round(worstRef.current)), 200);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);
  const reset = () => {
    worstRef.current = 0;
    setWorst(0);
  };
  return { dotRef, worst, reset };
}

export default function JpegResizeDemo() {
  const [samples, setSamples] = useState<Blob[] | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [mode, setMode] = useState<Mode>('pool');
  const [size, setSize] = useState(3);
  const [strategy, setStrategy] = useState<DispatchStrategy>('round-robin');
  const [respawn, setRespawn] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [load, setLoad] = useState<Array<number | null>>([]);
  const [running, setRunning] = useState(false);
  const poolRef = useRef<WorkerPool<ResizeJob, ResizeResult> | null>(null);
  const { lines, add } = useLog();
  const meter = useFrameMeter();

  // dựng lại pool khi đổi cấu hình
  useEffect(() => {
    const pool = new WorkerPool<ResizeJob, ResizeResult>({
      size,
      strategy,
      respawn,
      create: () => new Worker(new URL('../lib/imageResize.worker.ts', import.meta.url), { type: 'module' }),
      onWorkerError: (index, message) => add(`worker #${index} lỗi: ${message}${respawn ? ' → tạo worker mới' : ' → bị loại nhưng vẫn trong vòng xoay'}`, 'err'),
    });
    poolRef.current = pool;
    setLoad(pool.load());
    const id = setInterval(() => setLoad(pool.load()), 100);
    return () => {
      clearInterval(id);
      pool.terminate();
    };
  }, [size, strategy, respawn, add]);

  const prepare = async () => {
    setPreparing(true);
    const blobs: Blob[] = [];
    for (let i = 0; i < SAMPLE_SIZES.length; i++) blobs.push(await makeSample(SAMPLE_SIZES[i][0], SAMPLE_SIZES[i][1], i));
    setSamples(blobs);
    setPreparing(false);
    add(`đã tạo ${blobs.length} ảnh mẫu, tổng ${kb(blobs.reduce((s, b) => s + b.size, 0))}`, 'muted');
  };

  const run = async ({ crashFirst = false } = {}) => {
    if (!samples || !poolRef.current) return;
    setRunning(true);
    meter.reset();
    const pool = poolRef.current;
    const preset = RESIZE_PRESETS.high;
    const jobs: ResizeJob[] = samples.map((blob) => ({ blob, ...preset }));
    if (crashFirst) jobs.unshift({ blob: samples[0], ...preset, crash: true });
    setRows(
      jobs.map((job, i) => ({
        id: i + 1,
        worker: null,
        input: job.crash ? 'crash' : `${SAMPLE_SIZES[(i - (crashFirst ? 1 : 0)) % SAMPLE_SIZES.length].join('×')} · ${kb(job.blob.size)}`,
        status: 'chờ',
      })),
    );
    const start = performance.now();
    const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));

    if (mode === 'main') {
      for (let i = 0; i < jobs.length; i++) {
        if (jobs[i].crash) continue;
        const result = await resizeOnMainThread(jobs[i]);
        update(i, done(result));
      }
    } else {
      await Promise.all(
        jobs.map((job, i) => {
          const promise = pool.run(job);
          update(i, { worker: pool.lastWorkerIndex });
          return promise.then(
            (result) => update(i, done(result)),
            (error: Error) => update(i, { status: 'lỗi', output: error.message }),
          );
        }),
      );
    }
    const ms = Math.round(performance.now() - start);
    setTotal(ms);
    setRunning(false);
    add(`${mode === 'main' ? 'main thread' : `pool ${size} worker, ${strategy}${respawn ? '' : ', không respawn'}`}: ${ms}ms`, 'ok');
  };

  return (
    <div className='page jr'>
      <h1>Resize ảnh trong pool Web Worker</h1>
      <p className='hint'>
        Thu nhỏ ảnh về khung 2048×2048 (JPEG 85) trước khi upload. So cách làm ngay trên main thread với một pool worker như{' '}
        <code>WebWorkerPool</code> của Facebook. Chấm tròn chạy bằng requestAnimationFrame: main thread bị chặn là nó khựng.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={prepare} disabled={preparing || running}>
          {samples ? 'Tạo lại ảnh mẫu' : preparing ? 'Đang tạo…' : '1. Tạo 9 ảnh mẫu'}
        </button>
        <label className='switch'>
          <input type='radio' checked={mode === 'main'} onChange={() => setMode('main')} /> Main thread
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'pool'} onChange={() => setMode('pool')} /> Pool worker
        </label>
      </div>
      {mode === 'pool' && (
        <div className='toolbar'>
          <label className='switch'>
            Số worker
            <select value={size} onChange={(e) => setSize(Number(e.target.value))}>
              {[1, 2, 3, 4].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <label className='switch'>
            Chia việc
            <select value={strategy} onChange={(e) => setStrategy(e.target.value as DispatchStrategy)}>
              <option value='round-robin'>round-robin (như Facebook)</option>
              <option value='least-busy'>ít việc nhất</option>
            </select>
          </label>
          <label className='switch'>
            <input type='checkbox' checked={respawn} onChange={(e) => setRespawn(e.target.checked)} /> Tạo lại worker khi lỗi
          </label>
        </div>
      )}
      <div className='toolbar'>
        <button onClick={() => run()} disabled={!samples || running}>
          2. Resize 9 ảnh
        </button>
        {mode === 'pool' && (
          <button onClick={() => run({ crashFirst: true })} disabled={!samples || running}>
            Resize, job đầu làm worker crash
          </button>
        )}
      </div>
      <div className='jr-track' aria-hidden>
        <div ref={meter.dotRef} className='jr-dot' />
      </div>
      <div className='stats'>
        <Stat label='tổng thời gian' value={total == null ? '–' : `${total}ms`} />
        <Stat label='frame dài nhất' value={`${meter.worst}ms`} />
        {mode === 'pool' && <Stat label='job đang chạy / worker' value={load.map((n) => (n == null ? '✕' : n)).join(' · ')} />}
      </div>
      <div className='jr-table' role='table'>
        {rows.map((row) => (
          <div key={row.id} role='row' className={`jr-row ${row.status === 'lỗi' ? 'err' : row.status === 'chờ' ? 'muted' : ''}`}>
            <span>#{row.id}</span>
            <span>{row.worker == null ? '–' : `w${row.worker}`}</span>
            <span>{row.input}</span>
            <span>{row.output ?? row.status}</span>
            <span>{row.ms == null ? '' : `${row.ms}ms`}</span>
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

function done(result: ResizeResult): Partial<Row> {
  return {
    status: result.skipped ? 'bỏ qua' : 'xong',
    output: result.skipped ? 'đã đủ nhỏ, giữ nguyên' : `${result.outputWidth}×${result.outputHeight} · ${kb(result.blob.size)}`,
    ms: Math.round(result.ms),
  };
}


import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDebouncedFlag,
  createMediaLoader,
  planMediaTransition,
  type Progress,
} from '../lib/tgMediaLoader';
import { Log, Stat, sleep, useLog } from './shared';
import './TgMediaLoaderDemo.css';

const PHOTOS = 8;

/** "Mạng" giả: vẽ ảnh bằng canvas, trả về blob URL sau 400–1400ms, báo tiến độ 5 bước. */
async function fakeDownload(key: string, onProgress: Progress): Promise<string> {
  const index = Number(key.match(/photo-(\d+)/)?.[1] ?? 0);
  const total = 400 + ((index * 337) % 1000);
  for (let step = 1; step <= 5; step++) {
    await sleep(total / 5);
    onProgress(step / 5);
  }
  const canvas = document.createElement('canvas');
  canvas.width = 240;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 240, 160);
  grad.addColorStop(0, `hsl(${index * 45} 70% 55%)`);
  grad.addColorStop(1, `hsl(${index * 45 + 60} 70% 35%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 240, 160);
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(`#${index + 1}`, 20, 100);
  const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
  return URL.createObjectURL(blob);
}

type Loader = ReturnType<typeof createMediaLoader<string>>;

export default function TgMediaLoaderDemo() {
  return (
    <div className='page tg-media'>
      <h1>Telegram #18: mediaLoader, ảnh mờ → nét, spinner không chớp</h1>
      <Gallery />
      <BufferingDemo />
    </div>
  );
}

function Gallery() {
  const [dedupe, setDedupe] = useState(true);
  const [generation, setGeneration] = useState(0);
  const [, force] = useState(0);
  const loaderRef = useRef<Loader | undefined>(undefined);
  const callsRef = useRef(0);

  const loader = useMemo(() => {
    loaderRef.current?.clear();
    callsRef.current = 0;
    const real = createMediaLoader<string>({
      download: fakeDownload,
      maxItems: 50,
      onEvict: (_k, url) => URL.revokeObjectURL(url),
    });
    if (dedupe) return real;
    // Bản không gộp: mỗi lần gọi là một request, không có bộ nhớ đồng bộ
    const stats = { requests: 0, deduped: 0, memoryHits: 0 };
    const naive: Loader = {
      ...real,
      getFromMemory: () => undefined,
      fetch: (key, onProgress) => {
        stats.requests++;
        return fakeDownload(key, onProgress ?? (() => {}));
      },
      stats,
    };
    return naive;
  }, [dedupe]);
  loaderRef.current = loader;

  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <p className='hint'>
        Mỗi ảnh hiện ở hai chỗ (lưới và dải xem trước) với cùng một khoá <code>photo-N?size=m</code>. Bấm <b>Mount lại</b>:
        ảnh đã có trong bộ nhớ hiện ngay, không fade, không gọi mạng. Bỏ <b>Gộp request</b> để thấy số request tăng gấp đôi.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} /> Gộp request + bộ nhớ đồng bộ
        </label>
        <button onClick={() => setGeneration((g) => g + 1)}>↻ Mount lại</button>
        <button
          onClick={() => {
            loader.clear();
            setGeneration((g) => g + 1);
          }}
        >
          Xoá bộ nhớ
        </button>
      </div>
      <div className='stats'>
        <Stat label='lần gọi fetch' value={callsRef.current} />
        <Stat label='request mạng' value={loader.stats.requests} />
        <Stat label='gộp vào request đang bay' value={loader.stats.deduped} />
        <Stat label='đọc đồng bộ từ bộ nhớ' value={loader.stats.memoryHits} />
      </div>
      <div className='tgm-grid' key={`g${generation}-${dedupe}`}>
        {Array.from({ length: PHOTOS }, (_, i) => (
          <Photo key={i} index={i} loader={loader} onCall={() => callsRef.current++} />
        ))}
      </div>
      <div className='tgm-strip' key={`s${generation}-${dedupe}`}>
        {Array.from({ length: PHOTOS }, (_, i) => (
          <Photo key={i} index={i} loader={loader} small onCall={() => callsRef.current++} />
        ))}
      </div>
    </>
  );
}

function Photo({ index, loader, small, onCall }: { index: number; loader: Loader; small?: boolean; onCall(): void }) {
  const key = `photo-${index}?size=m`;
  // Đọc đồng bộ NGAY trong render: có sẵn thì lần vẽ đầu đã là ảnh nét
  const [src, setSrc] = useState(() => loader.getFromMemory(key));
  const plan = useRef(planMediaTransition(Boolean(src))).current;
  const [progress, setProgress] = useState(src ? 1 : 0);
  const [showThumb, setShowThumb] = useState(!src);

  useEffect(() => {
    if (src) return;
    let alive = true;
    const onProgress = (p: number) => alive && setProgress(p);
    onCall();
    loader.fetch(key, onProgress).then((url) => {
      if (!alive || !url) return;
      setSrc(url);
      setTimeout(() => alive && setShowThumb(false), plan.keepThumbMs);
    });
    return () => {
      alive = false;
      loader.cancelProgress(key, onProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loader]);

  return (
    <div className={`tgm-photo ${small ? 'small' : ''}`}>
      {showThumb && <div className='tgm-thumb' style={{ background: `hsl(${index * 45} 50% 50%)` }} />}
      {src && <img src={src} alt={`Ảnh ${index + 1}`} className={plan.willAnimate ? 'fade-in' : ''} />}
      {!src && (
        <div className='tgm-progress' aria-label={`Đang tải ${Math.round(progress * 100)}%`}>
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
}

// ---------- Spinner buffer ----------

type Step = { at: number; event: string; readyState: number; currentTime: number };

const SCENARIOS: Record<string, { label: string; steps: Step[] }> = {
  remount: {
    label: 'Remount video đã buffer',
    steps: [
      { at: 0, event: 'loadstart', readyState: 0, currentTime: 0 },
      { at: 40, event: 'loadeddata', readyState: 4, currentTime: 0 },
      { at: 60, event: 'playing', readyState: 4, currentTime: 0.02 },
    ],
  },
  flaky: {
    label: 'Mạng chập chờn',
    steps: [
      { at: 0, event: 'loadstart', readyState: 0, currentTime: 0 },
      { at: 600, event: 'playing', readyState: 4, currentTime: 0.1 },
      { at: 900, event: 'waiting', readyState: 2, currentTime: 0.4 },
      { at: 960, event: 'playing', readyState: 4, currentTime: 0.41 },
      { at: 1400, event: 'waiting', readyState: 2, currentTime: 0.9 },
      { at: 1500, event: 'playing', readyState: 4, currentTime: 0.9 },
      { at: 2000, event: 'waiting', readyState: 2, currentTime: 1.4 },
      { at: 2700, event: 'playing', readyState: 4, currentTime: 1.4 },
    ],
  },
};

function BufferingDemo() {
  const [naive, setNaive] = useState(true);
  const [smooth, setSmooth] = useState(true);
  const [flashes, setFlashes] = useState({ naive: 0, smooth: 0 });
  const log = useLog(12);
  const running = useRef(false);

  const run = async (name: keyof typeof SCENARIOS) => {
    if (running.current) return;
    running.current = true;
    const count = { naive: 0, smooth: 0 };
    let naiveValue = true;
    let smoothValue = true;
    const flag = createDebouncedFlag(true, 200, (v) => {
      smoothValue = v;
      setSmooth(v);
      if (!v) count.smooth++;
      setFlashes({ ...count });
    });
    const start = performance.now();
    for (const step of SCENARIOS[name].steps) {
      await sleep(Math.max(0, step.at - (performance.now() - start)));
      // Telegram coi là "đã buffer" khi readyState ≥ 3 HOẶC đã phát được chút ít
      const buffered = step.readyState >= 3 || (step.event === 'playing' && step.currentTime > 0);
      if (buffered !== naiveValue) {
        naiveValue = buffered;
        setNaive(buffered);
        if (!buffered) count.naive++;
      }
      flag.set(buffered);
      setFlashes({ ...count });
      log.add(`${step.event} (readyState ${step.readyState})`, 'muted');
    }
    await sleep(300);
    flag.dispose();
    void smoothValue;
    running.current = false;
  };

  return (
    <>
      <h2>Spinner buffer: hiện ngay hay chờ 200ms?</h2>
      <p className='hint'>
        Mỗi kịch bản phát lại một chuỗi sự kiện của thẻ video. Bên trái đổi spinner ngay theo từng sự kiện, bên phải chỉ
        đổi khi trạng thái giữ nguyên 200ms (giống <code>useBuffering</code>).
      </p>
      <div className='toolbar'>
        {Object.entries(SCENARIOS).map(([k, s]) => (
          <button key={k} onClick={() => run(k as keyof typeof SCENARIOS)}>
            ▶ {s.label}
          </button>
        ))}
      </div>
      <div className='split'>
        <div className='card tgm-player'>
          <div className='tgm-screen'>{!naive && <div className='spinner' aria-label='Đang buffer' />}</div>
          <Stat label='lần spinner hiện (đổi ngay)' value={flashes.naive} />
        </div>
        <div className='card tgm-player'>
          <div className='tgm-screen'>{!smooth && <div className='spinner' aria-label='Đang buffer' />}</div>
          <Stat label='lần spinner hiện (debounce 200ms)' value={flashes.smooth} />
        </div>
      </div>
      <Log lines={log.lines} />
    </>
  );
}

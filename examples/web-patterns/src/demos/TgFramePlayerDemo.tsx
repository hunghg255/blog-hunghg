import { useEffect, useRef, useState } from 'react';
import { FramePlayer, type FrameSource } from '../lib/tgFramePlayer';
import { Stat } from './shared';
import './TgFramePlayerDemo.css';

const SOURCE_FPS = 60;
const FRAMES = 120; // 2 giây mỗi vòng
const SMALL_COUNT = 6;

interface Settings {
  dpr: number;
  quality: number;
  timing: 'capped' | 'realtime';
  slowDisplay: boolean;
  speed: number;
  latency: number;
  cacheModulo: number;
}

/**
 * "Worker" giả: vẽ khung bằng canvas rồi trả ImageData sau `latency` ms.
 * Telegram render khung Lottie bằng rlottie (WASM) trong 4 worker; ở đây chỉ cần mô phỏng độ trễ.
 */
function createSource(hue: number, latency: () => number, counter: { rendered: number }): FrameSource {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return (frameIndex, size) =>
    new Promise((resolve) => {
      setTimeout(() => {
        canvas.width = size;
        canvas.height = size;
        const t = frameIndex / FRAMES;
        const s = size / 100;
        ctx.clearRect(0, 0, size, size);
        ctx.fillStyle = `hsl(${hue} 80% 92%)`;
        ctx.beginPath();
        ctx.arc(50 * s, 50 * s, 48 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(50 * s, 50 * s);
        ctx.rotate(t * Math.PI * 2);
        ctx.fillStyle = `hsl(${hue} 75% 55%)`;
        for (let i = 0; i < 5; i++) {
          ctx.rotate((Math.PI * 2) / 5);
          ctx.beginPath();
          ctx.ellipse(0, -24 * s, 9 * s, 18 * s, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
        // chấm chạy quanh vòng: nhìn là biết animation có giật hay chậm
        const a = t * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = '#222';
        ctx.beginPath();
        ctx.arc(50 * s + Math.cos(a) * 40 * s, 50 * s + Math.sin(a) * 40 * s, 5 * s, 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `${Math.round(11 * s)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(String(frameIndex), 50 * s, 54 * s);
        counter.rendered++;
        resolve(ctx.getImageData(0, 0, size, size));
      }, latency());
    });
}

/** Giả lập màn hình 30Hz: bỏ qua mỗi lần rAF thứ hai. */
function makeRequestFrame(slow: () => boolean) {
  return (cb: () => void) => {
    if (!slow()) return requestAnimationFrame(cb);
    return requestAnimationFrame(() => requestAnimationFrame(cb));
  };
}

export default function TgFramePlayerDemo() {
  const [settings, setSettings] = useState<Settings>({
    dpr: Math.min(3, Math.round(window.devicePixelRatio || 1)),
    quality: 1,
    timing: 'realtime',
    slowDisplay: false,
    speed: 1,
    latency: 8,
    cacheModulo: 4,
  });
  const [playing, setPlaying] = useState(true);
  const [version, setVersion] = useState(0);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const bigRef = useRef<HTMLCanvasElement>(null);
  const smallRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const playersRef = useRef<FramePlayer[]>([]);
  const counter = useRef({ rendered: 0 });
  const [loopMs, setLoopMs] = useState<number>();
  const [snapshot, setSnapshot] = useState({ cache: 0, cacheKB: 0, rendered: 0, waits: 0, skipped: 0, imgSize: 0 });

  // tạo lại player khi đổi các thông số cấu hình (DPR, quality, modulo)
  useEffect(() => {
    counter.current.rendered = 0;
    setLoopMs(undefined);
    const latency = () => settingsRef.current.latency;
    const requestFrame = makeRequestFrame(() => settingsRef.current.slowDisplay);
    const common = {
      framesCount: FRAMES,
      sourceFps: SOURCE_FPS,
      dpr: settings.dpr,
      timing: settingsRef.current.timing,
      requestFrame,
    };
    const big = new FramePlayer(bigRef.current!, createSource(200, latency, counter.current), {
      ...common,
      size: 160,
      quality: settings.quality,
      cacheModulo: settings.cacheModulo,
      onLoop: (ms) => setLoopMs(Math.round(ms)),
    });
    const small = smallRefs.current.map(
      (canvas, i) =>
        new FramePlayer(canvas!, createSource(20 + i * 50, latency, counter.current), {
          ...common,
          size: 64,
          isLowPriority: true,
          // ưu tiên thấp: Telegram giữ hết khung (modulo 0) vì đã giảm fps và độ phân giải
          cacheModulo: 0,
        }),
    );
    playersRef.current = [big, ...small];
    return () => playersRef.current.forEach((p) => p.destroy());
  }, [settings.dpr, settings.quality, settings.cacheModulo, version]);

  // các thông số đổi được khi đang chạy
  useEffect(() => {
    for (const p of playersRef.current) {
      p.setTiming(settings.timing);
      p.setSpeed(settings.speed);
    }
  }, [settings.timing, settings.speed, settings.dpr, settings.quality, settings.cacheModulo, version]);

  useEffect(() => {
    for (const p of playersRef.current) {
      if (playing) p.play();
      else p.pause();
    }
  }, [playing, settings.dpr, settings.quality, settings.cacheModulo, version]);

  useEffect(() => {
    const id = setInterval(() => {
      const [big] = playersRef.current;
      if (!big) return;
      const total = playersRef.current.reduce((sum, p) => sum + p.cacheSize * p.bytesPerFrame, 0);
      setSnapshot({
        cache: big.cacheSize,
        cacheKB: Math.round(total / 1024),
        rendered: counter.current.rendered,
        waits: big.stats.waits,
        skipped: big.stats.skipped,
        imgSize: big.imgSize,
      });
    }, 250);
    return () => clearInterval(id);
  }, []);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const expected = Math.round((FRAMES / SOURCE_FPS / settings.speed) * 1000);

  return (
    <div className='page tgfp'>
      <h1>Player khung hình kiểu RLottie</h1>
      <p className='hint'>
        Khung được "worker" render ra ImageData, main thread chỉ hẹn giờ, cache và vẽ. Sticker lớn: 60fps, chất lượng
        đầy đủ. Sáu sticker nhỏ: ưu tiên thấp, 30fps, quality 0.75.
      </p>

      <div className='tgfp-stage'>
        <div className='tgfp-big'>
          <canvas ref={bigRef} data-testid='big' />
          <span className='muted'>
            canvas {snapshot.imgSize}×{snapshot.imgSize}px cho 160px CSS
          </span>
        </div>
        <div className='tgfp-small'>
          {Array.from({ length: SMALL_COUNT }, (_, i) => (
            <canvas
              key={i}
              ref={(el) => {
                smallRefs.current[i] = el;
              }}
            />
          ))}
        </div>
      </div>

      <div className='stats'>
        <Stat label={`thời lượng 1 vòng (đúng: ${expected}ms)`} value={loopMs ? `${loopMs}ms` : '…'} />
        <Stat label='khung trong cache (sticker lớn)' value={`${snapshot.cache}/${FRAMES}`} />
        <Stat label='bộ nhớ khung (cả 7 sticker)' value={`${snapshot.cacheKB} KB`} />
        <Stat label='khung "worker" đã render' value={snapshot.rendered} />
        <Stat label='lần phải chờ khung' value={snapshot.waits} />
        <Stat label='khung bị bỏ qua để giữ nhịp' value={snapshot.skipped} />
      </div>

      <div className='tgfp-controls'>
        <div className='toolbar'>
          <button className='primary' onClick={() => setPlaying((p) => !p)}>
            {playing ? '⏸ Tạm dừng' : '▶ Chạy'}
          </button>
          <button onClick={() => setVersion((v) => v + 1)}>↻ Tạo lại player</button>
        </div>
        <label>
          Cách tính khung
          <select value={settings.timing} onChange={(e) => set('timing', e.target.value as Settings['timing'])} data-testid='timing'>
            <option value='realtime'>theo thời gian thật (bản viết lại)</option>
            <option value='capped'>tối đa 1 khung mỗi lần vẽ (bản gốc)</option>
          </select>
        </label>
        <label>
          <input
            type='checkbox'
            checked={settings.slowDisplay}
            onChange={(e) => set('slowDisplay', e.target.checked)}
            data-testid='slow'
          />{' '}
          Giả lập màn hình 30Hz / máy bận
        </label>
        <label>
          Tốc độ
          <select value={settings.speed} onChange={(e) => set('speed', +e.target.value)}>
            <option value={0.5}>0.5×</option>
            <option value={1}>1×</option>
            <option value={2}>2×</option>
          </select>
        </label>
        <label>
          DPR
          <select value={settings.dpr} onChange={(e) => set('dpr', +e.target.value)}>
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
        </label>
        <label>
          Quality sticker lớn
          <select value={settings.quality} onChange={(e) => set('quality', +e.target.value)}>
            <option value={1}>1</option>
            <option value={0.75}>0.75</option>
            <option value={0.5}>0.5</option>
          </select>
        </label>
        <label>
          Xoá khung theo modulo
          <select value={settings.cacheModulo} onChange={(e) => set('cacheModulo', +e.target.value)}>
            <option value={0}>0 (giữ hết)</option>
            <option value={4}>4 (Chrome/Firefox)</option>
            <option value={2}>2 (Safari)</option>
          </select>
        </label>
        <label>
          Độ trễ worker ({settings.latency}ms)
          <input type='range' min={0} max={60} value={settings.latency} onChange={(e) => set('latency', +e.target.value)} />
        </label>
      </div>
    </div>
  );
}

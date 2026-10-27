import { useEffect, useMemo, useRef, useState } from 'react';
import { bytesToDataUri, drawBlurred, encodeStripped, STRIPPED_HEADER, strippedToJpeg } from '../lib/tgTinyThumb';
import { decodePathBytes, encodePath, normalizePath, pathToSvgDataUri } from '../lib/tgStickerPath';
import { Stat } from './shared';
import './TgTinyThumbDemo.css';

const FULL_W = 640;
const FULL_H = 420;
const THUMB_MAX = 40;
const SCENES = ['Hoàng hôn', 'Biển', 'Rừng', 'Đêm'] as const;

/** Vẽ một "ảnh chụp" giả bằng canvas để demo không cần tải file. */
function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, scene: number) {
  const palettes = [
    ['#ff9a5a', '#ff5e7e', '#3b1e54', '#ffd27a'],
    ['#7fd3ff', '#2a86d6', '#0b3d6b', '#fff4c2'],
    ['#b8e986', '#4c9a4a', '#173d24', '#f4ffd8'],
    ['#2b2e6b', '#141633', '#05060f', '#f5f0c8'],
  ][scene];
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, palettes[0]);
  sky.addColorStop(0.6, palettes[1]);
  sky.addColorStop(1, palettes[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = palettes[3];
  ctx.beginPath();
  ctx.arc(w * (0.25 + scene * 0.15), h * 0.35, h * 0.12, 0, Math.PI * 2);
  ctx.fill();
  for (let layer = 0; layer < 3; layer++) {
    ctx.fillStyle = `rgba(0,0,0,${0.25 + layer * 0.2})`;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 12) {
      const y = h * (0.55 + layer * 0.12) - Math.sin(x / (w / (3 + layer)) + scene + layer) * h * 0.08;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.fill();
  }
}

function hex(bytes: Uint8Array, count: number) {
  return [...bytes.slice(0, count)].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export default function TgTinyThumbDemo() {
  return (
    <div className='page tgtt'>
      <h1>Thumbnail 100 byte và viền sticker nén</h1>
      <p className='hint'>
        Telegram gửi kèm mỗi ảnh một bản xem trước vài trăm byte, hiện ngay khi tin nhắn xuất hiện, trước khi ảnh thật
        tải xong.
      </p>
      <StrippedThumb />
      <StickerOutline />
    </div>
  );
}

function StrippedThumb() {
  const [scene, setScene] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [round, setRound] = useState(0);
  const fullRef = useRef<HTMLCanvasElement>(null);
  const blurRef = useRef<HTMLCanvasElement>(null);
  const [info, setInfo] = useState<{
    stripped: Uint8Array;
    jpeg: Uint8Array;
    dataUri: string;
    w: number;
    h: number;
    browserJpeg: number;
    fullJpeg: number;
    syncWidth: number;
  }>();

  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    (async () => {
      // 1. "Server": ảnh gốc → thu nhỏ còn ≤ 40px → mã hoá stripped
      const full = document.createElement('canvas');
      full.width = FULL_W;
      full.height = FULL_H;
      drawScene(full.getContext('2d')!, FULL_W, FULL_H, scene);
      const scale = THUMB_MAX / Math.max(FULL_W, FULL_H);
      const w = Math.round(FULL_W * scale);
      const h = Math.round(FULL_H * scale);
      const small = document.createElement('canvas');
      small.width = w;
      small.height = h;
      const sctx = small.getContext('2d')!;
      sctx.drawImage(full, 0, 0, w, h);
      const stripped = encodeStripped(sctx.getImageData(0, 0, w, h));

      // để so sánh: JPEG trình duyệt tự mã hoá (có header riêng của nó)
      const toSize = (c: HTMLCanvasElement, q: number) =>
        new Promise<number>((resolve) => c.toBlob((b) => resolve(b?.size ?? 0), 'image/jpeg', q));
      const [browserJpeg, fullJpeg] = await Promise.all([toSize(small, 0.6), toSize(full, 0.8)]);

      // 2. "Client": ghép header cố định → JPEG → data URI
      const jpeg = strippedToJpeg(stripped);
      const dataUri = bytesToDataUri(jpeg);

      // useBlurSync của Telegram thử giải mã đồng bộ ngay trong render
      const probe = new Image();
      probe.src = dataUri;
      const syncWidth = probe.width;

      const img = new Image();
      img.src = dataUri;
      await img.decode();
      if (cancelled) return;
      if (blurRef.current) {
        const blurred = drawBlurred(blurRef.current, img, w, h);
        blurRef.current.classList.toggle('css-blur', !blurred);
      }
      if (fullRef.current) {
        fullRef.current.width = FULL_W;
        fullRef.current.height = FULL_H;
        drawScene(fullRef.current.getContext('2d')!, FULL_W, FULL_H, scene);
      }
      setInfo({ stripped, jpeg, dataUri, w, h, browserJpeg, fullJpeg, syncWidth });
      // 3. Ảnh thật "tải xong" sau một lúc
      setTimeout(() => !cancelled && setLoaded(true), 1400);
    })();
    return () => {
      cancelled = true;
    };
  }, [scene, round]);

  return (
    <section className='card tgtt-section'>
      <h2>1. Ảnh: stripped thumbnail</h2>
      <div className='toolbar'>
        {SCENES.map((name, i) => (
          <button key={name} className={i === scene ? 'primary' : ''} onClick={() => setScene(i)}>
            {name}
          </button>
        ))}
        <button onClick={() => setRound((r) => r + 1)}>↻ Tải lại</button>
      </div>
      <div className='tgtt-photo'>
        <canvas ref={blurRef} className='tgtt-blur' aria-label='thumbnail đã làm mờ' />
        <canvas ref={fullRef} className={`tgtt-full ${loaded ? 'loaded' : ''}`} aria-label='ảnh thật' />
        <span className='badge'>{loaded ? 'ảnh thật' : 'thumbnail (đang tải ảnh thật…)'}</span>
      </div>
      {info && (
        <>
          <div className='stats'>
            <Stat label={`stripped ${info.w}×${info.h} (server gửi)`} value={`${info.stripped.length} B`} />
            <Stat label='header dùng chung (client có sẵn)' value={`${STRIPPED_HEADER.length} B`} />
            <Stat label='JPEG sau khi ghép' value={`${info.jpeg.length} B`} />
            <Stat label='JPEG cùng cỡ do trình duyệt mã hoá' value={`${info.browserJpeg} B`} />
            <Stat label={`ảnh ${FULL_W}px (JPEG)`} value={`${(info.fullJpeg / 1024).toFixed(1)} KB`} />
          </div>
          <p className='tgtt-hex'>
            <code data-testid='stripped-hex'>{hex(info.stripped, 12)} …</code>
            <span className='muted'>
              {' '}
              byte 0 = phiên bản (1), byte 1 = cao ({info.stripped[1]}), byte 2 = rộng ({info.stripped[2]}), sau đó là thân
              JPEG
            </span>
          </p>
          <p className='muted' data-testid='sync-decode'>
            Thử giải mã đồng bộ như useBlurSync: <code>new Image(); img.src = dataUri; img.width</code> →{' '}
            <b>{info.syncWidth}</b>
            {info.syncWidth ? ' (ảnh đã có trong cache bộ nhớ)' : ' (chưa giải mã kịp, phải chờ onload)'}
          </p>
        </>
      )}
    </section>
  );
}

/** Viền "blob" giả kiểu sticker: toạ độ tương đối, số nhỏ nên mỗi số chỉ tốn 1 byte. */
function makeBlobPath() {
  const points = 36;
  const at = (i: number) => {
    const a = (i / points) * Math.PI * 2 - Math.PI / 2;
    const r = 200 + Math.sin(a * 5) * 22 + Math.cos(a * 3) * 12;
    return [Math.round(256 + Math.cos(a) * r), Math.round(256 + Math.sin(a) * r)];
  };
  let [px, py] = at(0);
  let path = `M${px},${py}`;
  for (let i = 1; i < points; i++) {
    const [x, y] = at(i);
    path += ` l${x - px},${y - py}`;
    px = x;
    py = y;
  }
  return `${path} z`;
}

function StickerOutline() {
  const [path, setPath] = useState(makeBlobPath);
  const [showSticker, setShowSticker] = useState(false);
  const [round, setRound] = useState(0);

  const result = useMemo(() => {
    try {
      const bytes = encodePath(path);
      const decoded = decodePathBytes(bytes);
      return { bytes, decoded, ok: decoded === normalizePath(path), error: undefined as string | undefined };
    } catch (error) {
      return { bytes: new Uint8Array(), decoded: '', ok: false, error: (error as Error).message };
    }
  }, [path]);

  useEffect(() => {
    setShowSticker(false);
    const id = setTimeout(() => setShowSticker(true), 1400);
    return () => clearTimeout(id);
  }, [path, round]);

  return (
    <section className='card tgtt-section'>
      <h2>2. Sticker: viền nén thành bytes</h2>
      <label className='tgtt-path'>
        SVG path (viewBox 512×512)
        <textarea rows={3} value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
      </label>
      <div className='toolbar'>
        <button onClick={() => setRound((r) => r + 1)}>↻ Tải lại sticker</button>
        <button onClick={() => setPath(makeBlobPath())}>Path mẫu</button>
      </div>
      {result.error ? (
        <p className='err'>{result.error}</p>
      ) : (
        <div className='tgtt-sticker-row'>
          <div className='tgtt-sticker'>
            <img src={pathToSvgDataUri(result.decoded, 512, 512)} alt='' className='tgtt-placeholder' />
            <svg viewBox='0 0 512 512' className={`tgtt-real ${showSticker ? 'loaded' : ''}`} aria-hidden>
              <defs>
                <linearGradient id='tgtt-g' x1='0' y1='0' x2='1' y2='1'>
                  <stop offset='0' stopColor='#ffd166' />
                  <stop offset='1' stopColor='#ef476f' />
                </linearGradient>
              </defs>
              <path d={result.decoded} fill='url(#tgtt-g)' stroke='#fff' strokeWidth='10' />
              <circle cx='200' cy='220' r='22' fill='#222' />
              <circle cx='312' cy='220' r='22' fill='#222' />
              <path d='M196 310 q60 50 120 0' stroke='#222' strokeWidth='16' fill='none' strokeLinecap='round' />
            </svg>
          </div>
          <div className='stats'>
            <Stat label='path dạng chữ' value={`${normalizePath(path).length} ký tự`} />
            <Stat label='sau khi nén' value={`${result.bytes.length} B`} />
            <Stat label='giải mã lại khớp' value={result.ok ? '✓' : '✗'} />
          </div>
        </div>
      )}
      <p className='muted'>
        Bóng mờ (fill-opacity 0.1) hiện ngay từ path giải mã; sticker thật hiện sau 1,4 giây (giả lập tải WebP/Lottie).
      </p>
    </section>
  );
}

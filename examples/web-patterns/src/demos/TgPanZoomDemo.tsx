import { useEffect, useMemo, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import { clampToSafeArea, createPanZoom, toCss, tuneZoom, type Matrix, type Size } from '../lib/tgPanZoom';
import './TgPanZoomDemo.css';

const IMAGE: Size = { width: 480, height: 320 };
const SAFE = 150;
const LEVELS = [1, 1.5, 2, 2.5, 3];

/** Ảnh mẫu: lưới ô có số để dễ thấy đang zoom vào đâu. */
function makeImage() {
  const cells = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 6; x++) {
      const hue = (x * 40 + y * 70) % 360;
      cells.push(
        `<rect x="${x * 80}" y="${y * 80}" width="80" height="80" fill="hsl(${hue} 70% 55%)"/>` +
          `<text x="${x * 80 + 40}" y="${y * 80 + 50}" font-size="28" text-anchor="middle" fill="#fff" font-family="sans-serif">${y * 6 + x + 1}</text>`,
      );
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320">${cells.join('')}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Mô phỏng công thức "vùng an toàn" của bản gốc (không phải mã Telegram), viết theo mép trái ảnh.
 * Nhánh "ảnh lệch quá sang phải" trừ `left + W - safe` thay vì `left - (W - safe)`.
 */
function clampLikeOriginal(m: Matrix, frame: Size, image: Size, safe = SAFE): Matrix {
  const w = image.width * m.scale;
  const h = image.height * m.scale;
  let { tx, ty } = m;
  if (frame.width - safe < tx) tx -= tx + frame.width - safe;
  else if (w + tx < safe) tx -= w + tx - safe;
  if (frame.height - safe < ty) ty -= ty + frame.height - safe;
  else if (h + ty < safe) ty -= h + ty - safe;
  return { scale: m.scale, tx, ty };
}

/** Số px của ảnh còn nằm trong khung theo chiều ngang. */
function visibleWidth(m: Matrix, frame: Size, image: Size) {
  const left = Math.max(0, m.tx);
  const right = Math.min(frame.width, m.tx + image.width * m.scale);
  return Math.max(0, Math.round(right - left));
}

function SafeAreaSection() {
  const log = useLog(8);
  const frame = { width: 1000, height: 400 };
  const [m, setM] = useState<Matrix>({ scale: 1, tx: 260, ty: 40 });

  const run = (fixed: boolean) => {
    // ảnh đang ở scale 1.5 bị kéo sát mép phải (mép trái ở x = 900 > 1000 - 150)
    const dragged: Matrix = { scale: tuneZoom(1.5), tx: 900, ty: 40 };
    const next = fixed ? clampToSafeArea(dragged, frame, IMAGE, SAFE) : clampLikeOriginal(dragged, frame, IMAGE, SAFE);
    setM(next);
    const seen = visibleWidth(next, frame, IMAGE);
    log.add(
      `[${fixed ? 'bản sửa' : 'công thức gốc'}] mép trái: 900 → ${Math.round(next.tx)}, còn thấy ${seen}px ảnh`,
      seen >= SAFE ? 'ok' : 'err',
    );
  };

  return (
    <section className='tgp-section'>
      <h2>2. Công thức "vùng an toàn" bị sai dấu</h2>
      <p className='hint'>
        Khung rộng 1000px, vùng an toàn 150px, ảnh 480px đang ở scale 1.5 (rộng 720px) bị kéo sát mép phải: mép trái ở
        x = 900. Lẽ ra ảnh chỉ bị đẩy về x = 850 để còn 150px trong khung.
      </p>
      <div className='toolbar'>
        <button onClick={() => run(false)}>Áp công thức gốc</button>
        <button className='primary' onClick={() => run(true)}>
          Áp bản sửa
        </button>
      </div>
      <div className='tgp-mini' style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
        <div
          className='tgp-mini-img'
          data-testid='tgp-mini-img'
          style={{
            left: `${(m.tx / frame.width) * 100}%`,
            top: `${(m.ty / frame.height) * 100}%`,
            width: `${((IMAGE.width * m.scale) / frame.width) * 100}%`,
            height: `${((IMAGE.height * m.scale) / frame.height) * 100}%`,
          }}
        />
        <div className='tgp-mini-safe' style={{ left: `${((frame.width - SAFE) / frame.width) * 100}%` }} />
        <div className='tgp-mini-safe' style={{ left: `${(SAFE / frame.width) * 100}%` }} />
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

export default function TgPanZoomDemo() {
  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLImageElement>(null);
  const controllerRef = useRef<ReturnType<typeof createPanZoom> | null>(null);
  const [level, setLevel] = useState(1);
  const [m, setM] = useState<Matrix>({ scale: 1, tx: 0, ty: 0 });
  const src = useMemo(makeImage, []);

  // Ở scale 1 ảnh phải vừa khung: thu ảnh gốc 480×320 theo khung (màn hẹp thì nhỏ hơn)
  const [fit, setFit] = useState<Size>(IMAGE);

  useEffect(() => {
    const frame = frameRef.current!;
    const k = Math.min(1, frame.clientWidth / IMAGE.width, frame.clientHeight / IMAGE.height);
    const size = { width: Math.round(IMAGE.width * k), height: Math.round(IMAGE.height * k) };
    setFit(size);
    const pz = createPanZoom(frame, contentRef.current!, { image: size, onChange: setM });
    controllerRef.current = pz;
    setM(pz.matrix);
    return () => pz.destroy();
  }, []);

  const frameW = frameRef.current?.clientWidth ?? 0;
  const frameH = frameRef.current?.clientHeight ?? 0;

  return (
    <div className='page tgp'>
      <h1>Telegram: PanZoom bằng matrix()</h1>
      <p className='hint'>
        Kéo thanh zoom hoặc lăn chuột trên ảnh, rồi kéo ảnh (chuột, bút hoặc ngón tay; hai ngón để chụm). Thả chuột ở
        ngoài khung vẫn kết thúc kéo đúng nhờ <code>setPointerCapture</code>.
      </p>
      <section className='tgp-section'>
        <h2>1. Viewer</h2>
        <div className='toolbar'>
          <label className='tgp-range'>
            Mức zoom <b>{level}</b> → scale <b>{tuneZoom(level)}</b>
            <input
              type='range'
              min={0}
              max={LEVELS.length - 1}
              step={1}
              value={LEVELS.indexOf(level)}
              aria-label='Mức zoom'
              onChange={(e) => {
                const l = LEVELS[+e.target.value];
                setLevel(l);
                controllerRef.current?.setZoomLevel(l);
              }}
            />
          </label>
        </div>
        <div ref={frameRef} className='tgp-frame' data-testid='tgp-frame'>
          <img
            ref={contentRef}
            src={src}
            style={{ width: fit.width, height: fit.height }}
            alt='Ảnh mẫu dạng lưới'
            draggable={false}
          />
          <div className='tgp-safe-hint' style={{ width: SAFE }} />
          <div className='tgp-safe-hint right' style={{ width: SAFE }} />
        </div>
        <div className='stats'>
          <Stat label='scale' value={m.scale.toFixed(2)} />
          <Stat label='tx, ty' value={`${Math.round(m.tx)}, ${Math.round(m.ty)}`} />
          <Stat label='ảnh còn thấy (ngang)' value={frameW ? `${visibleWidth(m, { width: frameW, height: frameH }, fit)}px` : '—'} />
        </div>
        <p className='muted'>
          <code data-testid='tgp-css'>{toCss(m)}</code>
        </p>
      </section>
      <SafeAreaSection />
    </div>
  );
}

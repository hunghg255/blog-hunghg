import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { computeCropFocus, toOriginalCoordinates, type FocusPoint, type Rotation } from '../lib/faceCrop';
import './FaceCropDemo.css';

const IMG_W = 600;
const IMG_H = 400;
const IMAGE_RATIO = IMG_W / IMG_H;

const PRESETS: Record<string, FocusPoint[]> = {
  'Nhóm lệch phải': [
    { x: 0.12, y: 0.45 },
    { x: 0.62, y: 0.4 },
    { x: 0.72, y: 0.5 },
    { x: 0.8, y: 0.42 },
    { x: 0.9, y: 0.55 },
  ],
  'Hai nhóm': [
    { x: 0.08, y: 0.3 },
    { x: 0.18, y: 0.35 },
    { x: 0.55, y: 0.6 },
    { x: 0.62, y: 0.55 },
    { x: 0.7, y: 0.62 },
  ],
  'Một người': [{ x: 0.82, y: 0.35 }],
};

const RATIOS: Array<[string, number]> = [
  ['1:1', 1],
  ['4:5', 4 / 5],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['3:1', 3],
];

function photoSvg(points: FocusPoint[]) {
  const faces = points
    .map(
      (p, i) =>
        `<g transform="translate(${p.x * IMG_W} ${p.y * IMG_H})"><circle r="26" fill="hsl(${(i * 67) % 360} 70% 70%)"/><circle cx="-8" cy="-5" r="3" fill="#222"/><circle cx="8" cy="-5" r="3" fill="#222"/><path d="M-9 8 q9 8 18 0" stroke="#222" stroke-width="3" fill="none"/><rect x="-30" y="30" width="60" height="70" rx="20" fill="hsl(${(i * 67) % 360} 45% 45%)"/></g>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${IMG_W}" height="${IMG_H}" viewBox="0 0 ${IMG_W} ${IMG_H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7cc4ff"/><stop offset="1" stop-color="#3a6f4a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><rect y="300" width="100%" height="100" fill="#2f5137"/>${faces}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function CropView({ src, ratio, css, label, inView, total }: { src: string; ratio: number; css: { x: number; y: number }; label: string; inView: number; total: number }) {
  return (
    <figure className='fc-crop'>
      <div className='fc-frame' style={{ aspectRatio: String(ratio) }}>
        <img src={src} alt='' style={{ objectPosition: `${css.x * 100}% ${css.y * 100}%` }} />
      </div>
      <figcaption>
        <b>{label}</b>
        <span className={inView === total ? 'ok' : 'warn'}>
          {inView}/{total} mặt
        </span>
      </figcaption>
    </figure>
  );
}

export default function FaceCropDemo() {
  const [points, setPoints] = useState<FocusPoint[]>(PRESETS['Nhóm lệch phải']);
  const [ratio, setRatio] = useState(1);
  const [angle, setAngle] = useState<Rotation>(90);
  const [picked, setPicked] = useState<{ shown: { x: number; y: number }; original: { x: number; y: number } } | null>(null);
  const dragging = useRef<number | null>(null);
  const src = useMemo(() => photoSvg(points), [points]);

  const naive = { x: 0.5, y: 0.5 };
  const legacy = computeCropFocus(points, ratio, IMAGE_RATIO, { legacyMultiPoint: true });
  const fixed = computeCropFocus(points, ratio, IMAGE_RATIO);
  const countAt = (cssValue: number) => {
    const start = cssValue * (1 - fixed.visible);
    return points.filter((p) => p[fixed.axis] >= start && p[fixed.axis] <= start + fixed.visible).length;
  };

  const moveFace = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current == null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.min(0.97, Math.max(0.03, (event.clientX - rect.left) / rect.width));
    const y = Math.min(0.9, Math.max(0.1, (event.clientY - rect.top) / rect.height));
    const index = dragging.current;
    setPoints((prev) => prev.map((p, i) => (i === index ? { x, y } : p)));
  };

  // phần xoay: kích thước hiển thị của ảnh đã xoay
  const rotatedW = angle === 90 || angle === 270 ? IMG_H : IMG_W;
  const rotatedH = angle === 90 || angle === 270 ? IMG_W : IMG_H;
  const pickOnRotated = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const shown = { x: ((event.clientX - rect.left) / rect.width) * rotatedW, y: ((event.clientY - rect.top) / rect.height) * rotatedH };
    setPicked({ shown, original: toOriginalCoordinates(shown.x, shown.y, angle, IMG_W, IMG_H) });
  };

  return (
    <div className='page fc'>
      <h1>Crop ảnh theo nhiều khuôn mặt</h1>
      <p className='hint'>
        Kéo các khuôn mặt trên ảnh gốc, đổi tỉ lệ khung. Thuật toán tìm "cửa sổ" chứa nhiều mặt nhất (binary search trên toạ độ đã sắp xếp), hoà
        thì chọn chỗ cân lề nhất. Cột giữa lặp lại bug của <code>PixelzFocus</code>: nhánh nhiều mặt quên đổi tâm sang giá trị CSS.
      </p>
      <div className='toolbar'>
        {Object.keys(PRESETS).map((name) => (
          <button key={name} onClick={() => setPoints(PRESETS[name])}>
            {name}
          </button>
        ))}
        <span className='fc-sep' />
        {RATIOS.map(([label, value]) => (
          <button key={label} className={ratio === value ? 'primary' : ''} onClick={() => setRatio(value)}>
            {label}
          </button>
        ))}
      </div>
      <div
        className='fc-source'
        onPointerMove={moveFace}
        onPointerUp={() => (dragging.current = null)}
        onPointerLeave={() => (dragging.current = null)}
      >
        <img src={src} alt='Ảnh nhóm (giả lập)' draggable={false} />
        {points.map((p, i) => (
          <span
            key={i}
            className='fc-handle'
            style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
            onPointerDown={(event) => {
              dragging.current = i;
              event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
            }}
            aria-label={`Khuôn mặt ${i + 1}`}
          />
        ))}
        <span
          className='fc-window'
          style={
            fixed.axis === 'x'
              ? { left: `${fixed.css.x * (1 - fixed.visible) * 100}%`, width: `${fixed.visible * 100}%`, top: 0, bottom: 0 }
              : { top: `${fixed.css.y * (1 - fixed.visible) * 100}%`, height: `${fixed.visible * 100}%`, left: 0, right: 0 }
          }
        />
      </div>
      <p className='hint'>
        Cắt theo trục <b>{fixed.axis}</b>, nhìn thấy {(fixed.visible * 100).toFixed(0)}% ảnh. Khung viền cam là cửa sổ bản sửa chọn.
      </p>
      <div className='fc-crops'>
        <CropView src={src} ratio={ratio} css={naive} label='Cắt giữa' inView={countAt(0.5)} total={points.length} />
        <CropView src={src} ratio={ratio} css={legacy.css} label='Bản gốc (bug)' inView={legacy.inView} total={points.length} />
        <CropView src={src} ratio={ratio} css={fixed.css} label='Bản sửa' inView={fixed.inView} total={points.length} />
      </div>

      <h2>Toạ độ trên ảnh đã xoay</h2>
      <p className='hint'>Bấm lên ảnh đã xoay: toạ độ được đổi về ảnh gốc chỉ bằng hoán vị trục và trừ cạnh (rotationCoordinateTransform).</p>
      <div className='toolbar'>
        {([0, 90, 180, 270] as Rotation[]).map((a) => (
          <button key={a} className={angle === a ? 'primary' : ''} onClick={() => (setAngle(a), setPicked(null))}>
            {a}°
          </button>
        ))}
      </div>
      <div className='fc-rot'>
        <div className='fc-rot-box' style={{ aspectRatio: `${rotatedW} / ${rotatedH}` }} onClick={pickOnRotated}>
          <img
            src={src}
            alt='Ảnh đã xoay'
            style={{
              width: `${(IMG_W / rotatedW) * 100}%`,
              transform: `translate(-50%, -50%) rotate(${angle}deg)`,
            }}
          />
          {picked && <span className='fc-dot' style={{ left: `${(picked.shown.x / rotatedW) * 100}%`, top: `${(picked.shown.y / rotatedH) * 100}%` }} />}
        </div>
        <div className='fc-rot-box' style={{ aspectRatio: `${IMG_W} / ${IMG_H}` }}>
          <img src={src} alt='Ảnh gốc' style={{ width: '100%', transform: 'translate(-50%, -50%)' }} />
          {picked && <span className='fc-dot' style={{ left: `${(picked.original.x / IMG_W) * 100}%`, top: `${(picked.original.y / IMG_H) * 100}%` }} />}
        </div>
      </div>
      <p className='hint' data-testid='rot-result'>
        {picked
          ? `Trên ảnh xoay: (${picked.shown.x.toFixed(0)}, ${picked.shown.y.toFixed(0)}) → ảnh gốc: (${picked.original.x.toFixed(0)}, ${picked.original.y.toFixed(0)})`
          : 'Chưa chọn điểm.'}
      </p>
    </div>
  );
}

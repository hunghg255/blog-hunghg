import { useState } from 'react';
import {
  centerCrop,
  centerRange,
  isValidPlacement,
  matchCropKeys,
  rotatedCorners,
  scanRange,
  type PlacementRules,
} from '../lib/cropGeometry';
import { Stat } from './shared';
import './CropGeometryDemo.css';

const CROP_KEYS = [
  '191x100',
  '100x72',
  '110x80',
  '400x150',
  '600x360',
  '254x94',
  '254x133',
  '254x143',
  '284x149',
  '398x208',
  '125x90',
  '320x50',
  '100x100',
  '600x600',
  '400x500',
  '90x160',
];
const RATIOS = [
  { label: '1.91:1 ngang', value: 1.91 },
  { label: '1:1 vuông', value: 1 },
  { label: '4:5 dọc', value: 0.8 },
  { label: '9:16 toàn màn', value: 9 / 16 },
];

/** Cách khớp của bản gốc: |r − k| ≤ 0.01, tập không thứ tự */
const fbMatch = (ratio: number) =>
  CROP_KEYS.filter((k) => {
    const [w, h] = k.split('x').map(Number);
    return Math.abs(ratio - w / h) <= 0.01;
  });

const FRAME = { width: 1080, height: 1920 };
const RULES: PlacementRules = {
  frame: FRAME,
  aspect: 0.5,
  safeX: [0.1, 0.9],
  safeY: [0.15, 0.85],
  widthRange: [0.2, 0.9],
  turnsRange: [-0.25, 0.25],
};
const fmt = (r: [number, number] | null, scale = 1, unit = '') =>
  r ? `${(r[0] * scale).toFixed(2)}${unit} … ${(r[1] * scale).toFixed(2)}${unit}` : 'không có';

export default function CropGeometryDemo() {
  return (
    <div className='page crop-demo'>
      <h1>Crop đúng tỉ lệ, xoay sticker trong vùng an toàn</h1>
      <CropSection />
      <StickerSection />
    </div>
  );
}

function CropSection() {
  const [w, setW] = useState(1600);
  const [h, setH] = useState(1000);
  const [ratio, setRatio] = useState(1.91);
  const crop = centerCrop({ width: w, height: h }, ratio);
  const scale = 300 / Math.max(w, h);
  const imageRatio = w / h;
  return (
    <>
      <p className='hint'>
        Phần 1: ảnh {w}×{h}, chọn tỉ lệ quảng cáo. Vùng sáng là crop lớn nhất đúng tỉ lệ, đặt giữa
        ảnh.
      </p>
      <div className='crop-grid'>
        <svg viewBox={`0 0 ${w * scale} ${h * scale}`} className='crop-svg' data-testid='crop-svg'>
          <rect width={w * scale} height={h * scale} className='crop-image' />
          <rect
            x={crop.x * scale}
            y={crop.y * scale}
            width={crop.width * scale}
            height={crop.height * scale}
            className='crop-area'
          />
        </svg>
        <div className='crop-controls'>
          <label>
            Rộng {w}px
            <input
              type='range'
              min={200}
              max={4000}
              step={10}
              value={w}
              onChange={(e) => setW(+e.target.value)}
            />
          </label>
          <label>
            Cao {h}px
            <input
              type='range'
              min={200}
              max={4000}
              step={10}
              value={h}
              onChange={(e) => setH(+e.target.value)}
            />
          </label>
          <div className='toolbar'>
            {RATIOS.map((r) => (
              <button
                key={r.label}
                className={r.value === ratio ? 'primary' : ''}
                onClick={() => setRatio(r.value)}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className='stats'>
        <Stat
          label='crop (x, y, rộng × cao)'
          value={
            <output data-testid='crop'>{`${crop.x}, ${crop.y}, ${crop.width}×${crop.height}`}</output>
          }
        />
        <Stat label='tỉ lệ ảnh gốc' value={<output>{imageRatio.toFixed(4)}</output>} />
        <Stat
          label='khoá khớp tỉ lệ ảnh: bản gốc (±0.01)'
          value={
            <output data-testid='fb-keys'>{fbMatch(imageRatio).join(', ') || 'không có'}</output>
          }
        />
        <Stat
          label='bản viết lại (±0.5%, gần nhất trước)'
          value={
            <output data-testid='our-keys'>
              {matchCropKeys(imageRatio, CROP_KEYS).join(', ') || 'không có'}
            </output>
          }
        />
      </div>
      <div className='toolbar'>
        <button onClick={() => (setW(1910), setH(1000))}>Ảnh 1910×1000</button>
        <button onClick={() => (setW(1600), setH(900))}>Ảnh 16:9</button>
        <button onClick={() => (setW(2560), setH(400))} data-testid='banner'>
          Banner 6.4:1
        </button>
      </div>
    </>
  );
}

function StickerSection() {
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.5);
  const [width, setWidth] = useState(0.5);
  const [deg, setDeg] = useState(20);
  const turns = deg / 360;
  const p = { x, y, width, turns };
  const valid = isValidPlacement(p, RULES);
  const corners = rotatedCorners(turns, width, RULES.aspect, FRAME);
  const S = 0.15; // khung 1080×1920 vẽ ở 162×288
  const pts = corners
    .map(([cx, cy]) => `${(x + cx) * FRAME.width * S},${(y + cy) * FRAME.height * S}`)
    .join(' ');
  const xRange = centerRange(p, RULES, 0);
  const yRange = centerRange(p, RULES, 1);
  const wRange = scanRange(0.2, 0.9, 0.01, width, (v) =>
    isValidPlacement({ ...p, width: v }, RULES),
  );
  const tRange = scanRange(-0.25, 0.25, 1 / 360, turns, (v) =>
    isValidPlacement({ ...p, turns: v }, RULES),
  );
  return (
    <>
      <p className='hint'>
        Phần 2: sticker bình chọn trên story 9:16. Mọi góc của sticker (sau khi xoay) phải nằm trong
        vùng an toàn (khung nét đứt). Xoay tính trong không gian pixel rồi mới chuẩn hoá, nên hình
        không méo.
      </p>
      <div className='crop-grid'>
        <svg
          viewBox={`0 0 ${FRAME.width * S} ${FRAME.height * S}`}
          className='crop-story'
          data-testid='story-svg'
        >
          <rect width={FRAME.width * S} height={FRAME.height * S} className='crop-image' />
          <rect
            x={RULES.safeX[0] * FRAME.width * S}
            y={RULES.safeY[0] * FRAME.height * S}
            width={(RULES.safeX[1] - RULES.safeX[0]) * FRAME.width * S}
            height={(RULES.safeY[1] - RULES.safeY[0]) * FRAME.height * S}
            className='crop-safe'
          />
          <polygon points={pts} className={valid ? 'crop-sticker ok' : 'crop-sticker bad'} />
        </svg>
        <div className='crop-controls'>
          <label>
            Tâm x {x.toFixed(2)}
            <input
              type='range'
              min={0}
              max={1}
              step={0.01}
              value={x}
              onChange={(e) => setX(+e.target.value)}
            />
          </label>
          <label>
            Tâm y {y.toFixed(2)}
            <input
              type='range'
              min={0}
              max={1}
              step={0.01}
              value={y}
              onChange={(e) => setY(+e.target.value)}
            />
          </label>
          <label>
            Rộng {width.toFixed(2)}
            <input
              type='range'
              min={0.2}
              max={0.9}
              step={0.01}
              value={width}
              onChange={(e) => setWidth(+e.target.value)}
            />
          </label>
          <label>
            Xoay {deg}°
            <input
              type='range'
              min={-90}
              max={90}
              step={1}
              value={deg}
              onChange={(e) => setDeg(+e.target.value)}
              data-testid='rotate'
            />
          </label>
        </div>
      </div>
      <div className='stats'>
        <Stat
          label='vị trí'
          value={<output data-testid='valid'>{valid ? 'hợp lệ' : 'ra ngoài vùng an toàn'}</output>}
        />
        <Stat label='tâm x hợp lệ' value={<output data-testid='x-range'>{fmt(xRange)}</output>} />
        <Stat label='tâm y hợp lệ' value={<output>{fmt(yRange)}</output>} />
        <Stat label='độ rộng hợp lệ' value={<output>{fmt(wRange)}</output>} />
        <Stat label='góc xoay hợp lệ (gần nhất)' value={<output>{fmt(tRange, 360, '°')}</output>} />
      </div>
    </>
  );
}

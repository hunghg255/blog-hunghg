import { useMemo, useState, type PointerEvent } from 'react';
import { CollageGrid, type CollagePhoto } from '../lib/collageGrid';
import { selectPageLayout, selectUserLayout, type LayoutScore } from '../lib/collageLayout';
import './PhotoCollageDemo.css';

interface Preset {
  label: string;
  width: number;
  height: number;
}

const PRESETS: Preset[] = [
  { label: 'Ngang 3:2', width: 1500, height: 1000 },
  { label: 'Dọc 2:3', width: 1000, height: 1500 },
  { label: 'Vuông', width: 1200, height: 1200 },
  { label: '16:9', width: 1600, height: 900 },
  { label: '9:16', width: 900, height: 1600 },
  { label: 'Panorama 3:1', width: 2400, height: 800 },
];

const HUES = [12, 210, 140, 280, 40, 330, 180, 90];

/**
 * Ảnh giả bằng SVG: nền gradient, lưới, nhãn tỉ lệ và một "chủ thể" (hình tròn) lệch khỏi tâm,
 * để thấy rõ cắt-ở-giữa làm mất chủ thể, còn focal point thì giữ lại được.
 */
function fakePhoto(index: number, preset: Preset) {
  const { width: w, height: h, label } = preset;
  const hue = HUES[index % HUES.length];
  const sx = w * 0.78;
  const sy = h * 0.28;
  const r = Math.min(w, h) * 0.13;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 70% 55%)"/><stop offset="1" stop-color="hsl(${hue + 50} 70% 35%)"/>
    </linearGradient>
    <pattern id="p" width="${w / 6}" height="${h / 6}" patternUnits="userSpaceOnUse">
      <path d="M ${w / 6} 0 L 0 0 0 ${h / 6}" fill="none" stroke="white" stroke-opacity=".18" stroke-width="${w / 300}"/>
    </pattern></defs>
    <rect width="${w}" height="${h}" fill="url(#g)"/><rect width="${w}" height="${h}" fill="url(#p)"/>
    <circle cx="${sx}" cy="${sy}" r="${r}" fill="white" fill-opacity=".92"/>
    <circle cx="${sx - r * 0.35}" cy="${sy - r * 0.15}" r="${r * 0.12}" fill="#222"/>
    <circle cx="${sx + r * 0.35}" cy="${sy - r * 0.15}" r="${r * 0.12}" fill="#222"/>
    <path d="M ${sx - r * 0.4} ${sy + r * 0.3} Q ${sx} ${sy + r * 0.65} ${sx + r * 0.4} ${sy + r * 0.3}"
      stroke="#222" stroke-width="${r * 0.1}" fill="none" stroke-linecap="round"/>
    <text x="${w * 0.06}" y="${h * 0.92}" font-family="system-ui,sans-serif" font-weight="700"
      font-size="${Math.min(w, h) * 0.14}" fill="white">#${index + 1} ${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

interface DemoPhoto extends CollagePhoto {
  preset: Preset;
  id: number;
}

let nextId = 0;
function makePhoto(preset: Preset, index: number): DemoPhoto {
  return { id: nextId++, preset, src: fakePhoto(index, preset), width: preset.width, height: preset.height };
}

/** Sơ đồ mini của một bố cục: ô càng đỏ càng bị cắt nhiều. */
function LayoutDiagram({ score }: { score: LayoutScore }) {
  const cells = score.layout.cells;
  const cols = Math.max(...cells.map((c) => c[1]));
  const rows = Math.max(...cells.map((c) => c[2]));
  return (
    // chiều cao cố định, giữ tỉ lệ: bố cục 1 ảnh (lưới 1×1) không bị phóng to chiếm cả thẻ
    <svg viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio='xMidYMid meet' style={{ height: 72 }}>
      {cells.map(([t, r, b, l], i) => {
        const loss = score.cells[i]?.loss ?? 0;
        return (
          <g key={i}>
            <rect
              x={l + 0.05}
              y={t + 0.05}
              width={r - l - 0.1}
              height={b - t - 0.1}
              rx={0.15}
              fill={`color-mix(in oklab, var(--err) ${Math.round(loss * 100)}%, var(--surface-2))`}
            />
            <text x={(l + r) / 2} y={(t + b) / 2 + 0.17} fontSize={Math.min(0.5, (r - l) / 3)} textAnchor='middle' fill='currentColor'>
              {i + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Ảnh thu nhỏ, bấm/kéo để đặt focal point. */
function FocusPicker({
  photo,
  index,
  onFocus,
  onRemove,
}: {
  photo: DemoPhoto;
  index: number;
  onFocus: (x: number, y: number) => void;
  onRemove: () => void;
}) {
  const set = (event: PointerEvent<HTMLDivElement>) => {
    const img = event.currentTarget.querySelector('img')!;
    const rect = img.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    onFocus(x, y);
  };
  return (
    <div
      className='pc-photo'
      data-testid={`photo-${index}`}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        set(e);
      }}
      onPointerMove={(e) => e.buttons === 1 && set(e)}
    >
      <span className='pc-index'>{index + 1}</span>
      <button className='pc-remove' aria-label={`Xoá ảnh ${index + 1}`} onClick={onRemove}>
        ×
      </button>
      <div className='pc-photo-inner'>
        <img src={photo.src} alt='' />
        <span className='pc-focus' style={{ left: `${(photo.focusX ?? 0.5) * 100}%`, top: `${(photo.focusY ?? 0.5) * 100}%` }} />
      </div>
    </div>
  );
}

export default function PhotoCollageDemo() {
  const [photos, setPhotos] = useState<DemoPhoto[]>(() => [
    makePhoto(PRESETS[0], 0),
    makePhoto(PRESETS[1], 1),
    makePhoto(PRESETS[2], 2),
  ]);
  const [actor, setActor] = useState<'user' | 'page'>('user');

  const media = useMemo(() => photos.map((p) => [p.width, p.height] as const), [photos]);
  const result = useMemo(
    () => (actor === 'user' ? selectUserLayout(media) : selectPageLayout(media)),
    [media, actor],
  );

  const add = (preset: Preset) =>
    setPhotos((prev) => (prev.length >= 8 ? prev : [...prev, makePhoto(preset, prev.length)]));

  return (
    <div className='page'>
      <h1>Chọn bố cục collage ảnh</h1>
      <p className='hint'>
        Thêm/bớt ảnh với tỉ lệ khác nhau và xem điểm của từng bố cục. Bấm hoặc kéo trên ảnh thu nhỏ để
        đặt điểm focus (mặt cười) cho ảnh đó.
      </p>
      <div className='toolbar'>
        {PRESETS.map((preset) => (
          <button key={preset.label} onClick={() => add(preset)} disabled={photos.length >= 8}>
            + {preset.label}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' name='actor' checked={actor === 'user'} onChange={() => setActor('user')} />
          Người dùng (chấm điểm)
        </label>
        <label className='switch'>
          <input type='radio' name='actor' checked={actor === 'page'} onChange={() => setActor('page')} />
          Page (khớp hướng ảnh đầu)
        </label>
      </div>

      <div className='pc-photos'>
        {photos.map((photo, i) => (
          <FocusPicker
            key={photo.id}
            photo={photo}
            index={i}
            onFocus={(x, y) =>
              setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, focusX: x, focusY: y } : p)))
            }
            onRemove={() => setPhotos((prev) => prev.filter((p) => p.id !== photo.id))}
          />
        ))}
      </div>

      <div className='pc-layout'>
        <div className='pc-preview' data-testid='collage'>
          {photos.length > 0 && result.winner ? (
            <CollageGrid photos={photos} placed={result.placed} overflowCount={result.overflowCount} />
          ) : (
            <p className='hint' style={{ padding: 16 }}>
              {photos.length === 0 ? 'Chưa có ảnh.' : 'Không có bố cục Page nào có ô đầu cùng hướng với ảnh đầu.'}
            </p>
          )}
        </div>
        <div>
          <p className='hint' style={{ marginTop: 0 }}>
            {result.candidates.length} bố cục được xét. Điểm = Σ điểm từng ô (≤ 0, phạt theo độ cắt) + 200 × số ô.
          </p>
          <div className='pc-candidates'>
            {result.candidates.map((c, i) => (
              <div
                key={i}
                className={`pc-candidate${c === result.winner ? ' winner' : ''}`}
                data-testid={c === result.winner ? 'winner' : undefined}
              >
                <LayoutDiagram score={c} />
                <b>{actor === 'user' ? c.total.toFixed(1) : '—'}</b>
                {c === result.winner && <span className='ok'> ✓ chọn</span>}
                <div className='muted'>
                  cắt: {c.cells.map((cell) => `${Math.round(cell.loss * 100)}%`).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

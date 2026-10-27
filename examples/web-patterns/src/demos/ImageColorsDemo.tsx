import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  averageColor,
  averageColorTelegram,
  blendOver,
  contrastRatio,
  gradientVars,
  hsvToRgb,
  parseCssColor,
  patternColor,
  patternColorTelegram,
  prefersLightText,
  prefersLightTextTrello,
  toHex,
  type ImageInput,
  type RGB,
} from '../lib/imageColors';
import './ImageColorsDemo.css';

// ---------- hình nền tự vẽ (không tải ảnh ngoài) ----------

interface Wallpaper {
  name: string;
  image: ImageInput;
  url: string;
}

function paintWallpaper(name: string, stops: string[], dots: string): Wallpaper {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 1600, 1000);
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = dots;
  for (let y = 40; y < 1000; y += 90) {
    for (let x = (y / 90) % 2 ? 40 : 85; x < 1600; x += 90) {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return { name, image: canvas, url: canvas.toDataURL('image/jpeg', 0.7) };
}

const timed = <T,>(fn: () => T): [T, number] => {
  const start = performance.now();
  const value = fn();
  return [value, performance.now() - start];
};

// ---------- 1. Telegram ----------

function WallpaperPanel() {
  const presets = useMemo(
    () => [
      paintWallpaper('Đồng cỏ', ['#cfe8b0', '#a9d18e', '#e3efc8'], 'rgba(255,255,255,.35)'),
      paintWallpaper('Hoàng hôn', ['#ffb27a', '#f2709c', '#ffd36e'], 'rgba(255,255,255,.3)'),
      paintWallpaper('Đêm', ['#1b2a49', '#2c3e66', '#0f1a30'], 'rgba(255,255,255,.12)'),
      paintWallpaper('Biển', ['#78c5e8', '#3f8fc4', '#a7e0f2'], 'rgba(255,255,255,.25)'),
    ],
    [],
  );
  const [custom, setCustom] = useState<Wallpaper | null>(null);
  const [index, setIndex] = useState(0);
  const wallpaper = custom ?? presets[index];

  const stats = useMemo(() => {
    const [tg, tgMs] = timed(() => averageColorTelegram(wallpaper.image));
    const [small, smallMs] = timed(() => averageColor(wallpaper.image, { size: 32 }));
    const [lin] = timed(() => averageColor(wallpaper.image, { size: 32, linear: true }));
    return { tg, tgMs, small, smallMs, lin };
  }, [wallpaper]);

  const base = stats.small ?? [128, 128, 128];
  const original = patternColorTelegram(base);
  const fixed = patternColor(base);
  const pill = (css: string) => {
    const parsed = parseCssColor(css);
    if (!parsed) return { css, ratio: 0, hex: '' };
    const solid = blendOver(parsed.rgb, parsed.alpha, base);
    return { css, ratio: contrastRatio(solid, [255, 255, 255]), hex: toHex(solid) };
  };
  const pillOriginal = pill(original);
  const pillFixed = pill(fixed);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const bitmap = await createImageBitmap(file);
    setCustom({ name: file.name, image: bitmap, url: URL.createObjectURL(file) });
  };

  return (
    <section className='card ic-panel'>
      <h2>1. Màu trung bình của hình nền, màu "pill" ngày tháng (Telegram)</h2>
      <div className='toolbar'>
        {presets.map((p, i) => (
          <button
            key={p.name}
            className={!custom && i === index ? 'primary' : ''}
            onClick={() => {
              setCustom(null);
              setIndex(i);
            }}
          >
            {p.name}
          </button>
        ))}
        <label className='ic-file'>
          Ảnh của bạn <input type='file' accept='image/*' onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
      </div>
      <div className='ic-chat' style={{ backgroundImage: `url(${wallpaper.url})`, backgroundColor: toHex(base) }}>
        <span className='ic-pill' style={{ background: pillOriginal.css }} data-testid='pill-original'>
          Hôm nay · bản Telegram Web
        </span>
        <div className='ic-bubble'>Ảnh nền đổi thì màu pill đổi theo 👋</div>
        <span className='ic-pill' style={{ background: pillFixed.css }} data-testid='pill-fixed'>
          Hôm nay · HSV → RGB
        </span>
      </div>
      <div className='ic-swatches'>
        <Swatch label={`Telegram: ảnh gốc, 1/5 pixel (${stats.tgMs.toFixed(1)} ms)`} rgb={stats.tg} testId='avg-telegram' />
        <Swatch label={`Thu về 32px (${stats.smallMs.toFixed(1)} ms)`} rgb={stats.small} testId='avg-small' />
        <Swatch label='32px, trung bình tuyến tính' rgb={stats.lin} />
      </div>
      <p className='hint' data-testid='pill-contrast'>
        Chữ trắng trên pill: bản Telegram Web {pillOriginal.ratio.toFixed(2)}:1 ({pillOriginal.hex}), bản HSV → RGB {pillFixed.ratio.toFixed(2)}:1 ({pillFixed.hex}).
      </p>
    </section>
  );
}

function Swatch({ label, rgb, testId }: { label: string; rgb: RGB | null; testId?: string }) {
  return (
    <div className='ic-swatch'>
      <span className='ic-chip' style={{ background: rgb ? toHex(rgb) : 'transparent' }} />
      <span>
        <b data-testid={testId}>{rgb ? toHex(rgb) : 'null (canvas bị taint)'}</b>
        <br />
        <small>{label}</small>
      </span>
    </div>
  );
}

// ---------- 2. App Store ----------

const ICONS: { name: string; rgb: RGB }[] = [
  { name: 'Ghi chú', rgb: [252, 211, 77] },
  { name: 'Nhạc', rgb: [244, 63, 94] },
  { name: 'Bản đồ', rgb: [52, 211, 153] },
  { name: 'Thời tiết', rgb: [56, 189, 248] },
  { name: 'Đồng hồ', rgb: [20, 20, 22] },
  { name: 'Cài đặt', rgb: [142, 142, 147] },
  { name: 'Sách', rgb: [251, 146, 60] },
  { name: 'Podcast', rgb: [167, 139, 250] },
];

function GradientPanel() {
  const [picked, setPicked] = useState<string[]>(['Ghi chú', 'Nhạc', 'Đồng hồ', 'Cài đặt', 'Podcast']);
  const [removeGreys, setRemoveGreys] = useState(true);
  const colors = ICONS.filter((i) => picked.includes(i.name)).map((i) => i.rgb);
  const vars = gradientVars(colors, { removeGreys });
  return (
    <section className='card ic-panel'>
      <h2>2. Gradient 4 góc từ màu của các icon (App Store)</h2>
      <div className='ic-icons'>
        {ICONS.map((icon) => (
          <button
            key={icon.name}
            className={`ic-icon${picked.includes(icon.name) ? ' is-on' : ''}`}
            aria-pressed={picked.includes(icon.name)}
            onClick={() => setPicked((p) => (p.includes(icon.name) ? p.filter((x) => x !== icon.name) : [...p, icon.name]))}
          >
            <span style={{ background: toHex(icon.rgb) }} />
            {icon.name}
          </button>
        ))}
      </div>
      <label className='ic-check'>
        <input type='checkbox' checked={removeGreys} onChange={(e) => setRemoveGreys(e.target.checked)} /> Bỏ màu xám (shouldRemoveGreys)
      </label>
      <div className='ic-gradient' style={vars as CSSProperties} data-testid='gradient-card'>
        <div className='ic-gradient-title'>Ứng dụng cho mùa thi</div>
      </div>
      <code className='ic-code' data-testid='gradient-vars'>
        {Object.entries(vars)
          .map(([k, v]) => `${k}: ${v}`)
          .join('; ') || '(không còn màu nào, dùng màu mặc định #000)'}
      </code>
    </section>
  );
}

// ---------- 3. Trello ----------

function TextColorPanel() {
  const [rule, setRule] = useState<'trello' | 'wcag'>('trello');
  const [picked, setPicked] = useState<RGB>([0, 120, 255]);
  const grid = useMemo(() => {
    const cells: RGB[] = [];
    for (let v = 0.45; v <= 1.001; v += 0.11) {
      for (let h = 0; h < 360; h += 30) cells.push(hsvToRgb([h / 360, 0.85, v]));
    }
    return cells;
  }, []);
  const disagree = grid.filter((c) => prefersLightTextTrello(c) !== prefersLightText(c)).length;
  const choose = rule === 'trello' ? prefersLightTextTrello : prefersLightText;
  const white = contrastRatio(picked, [255, 255, 255]);
  const black = contrastRatio(picked, [0, 0, 0]);

  return (
    <section className='card ic-panel'>
      <h2>3. Chữ trắng hay chữ đen trên nhãn màu (Trello)</h2>
      <div className='toolbar'>
        <button className={rule === 'trello' ? 'primary' : ''} onClick={() => setRule('trello')}>
          Ngưỡng luma 0.4623 (Trello)
        </button>
        <button className={rule === 'wcag' ? 'primary' : ''} onClick={() => setRule('wcag')}>
          Tỉ lệ tương phản WCAG
        </button>
      </div>
      <p className='hint' data-testid='disagree'>
        {disagree}/{grid.length} ô hai cách chọn khác nhau (viền nét đứt).
      </p>
      <div className='ic-grid'>
        {grid.map((c, i) => (
          <button
            key={i}
            className={`ic-cell${prefersLightTextTrello(c) !== prefersLightText(c) ? ' is-diff' : ''}`}
            style={{ background: toHex(c), color: choose(c) ? '#fff' : '#111' }}
            onClick={() => setPicked(c)}
            aria-label={toHex(c)}
          >
            Aa
          </button>
        ))}
      </div>
      <p className='hint'>
        <span className='ic-chip' style={{ background: toHex(picked) }} /> {toHex(picked)}: chữ trắng {white.toFixed(2)}:1, chữ đen {black.toFixed(2)}:1 → Trello chọn{' '}
        <b>{prefersLightTextTrello(picked) ? 'trắng' : 'đen'}</b>, WCAG chọn <b>{prefersLightText(picked) ? 'trắng' : 'đen'}</b>.
      </p>
    </section>
  );
}

export default function ImageColorsDemo() {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return (
    <div className='page image-colors-demo'>
      <h1>Lấy màu từ ảnh, chọn màu chữ</h1>
      <p className='hint'>Màu trung bình của hình nền (Telegram), gradient từ màu icon (App Store), chữ sáng hay tối trên nhãn (Trello).</p>
      {ready && <WallpaperPanel />}
      <GradientPanel />
      <TextColorPanel />
    </div>
  );
}

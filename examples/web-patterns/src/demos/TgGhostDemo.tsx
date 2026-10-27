import { useMemo, useRef, useState } from 'react';
import { animateClosing, animateOpening, fitInto, type Rect } from '../lib/tgGhostAnimation';
import { Log, useLog } from './shared';
import './TgGhostDemo.css';

interface Photo {
  id: number;
  src: string;
  width: number;
  height: number;
}

const SIZES: [number, number][] = [
  [1600, 900], [900, 1600], [1200, 1200], [1500, 1000], [800, 1200], [2000, 800],
  [1000, 1500], [1280, 960], [1080, 1350], [1920, 1080], [1000, 1000], [700, 1400],
];
const HUES = [200, 20, 140, 280, 340, 50, 180, 100, 0, 240, 310, 160];

/** Ảnh mẫu vẽ bằng canvas (không tải file ngoài), có khung viền để thấy rõ khi bị crop hay méo. */
function makePhoto(id: number, width: number, height: number): Photo {
  const canvas = document.createElement('canvas');
  const scale = 400 / Math.max(width, height);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  const hue = HUES[id % HUES.length];
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, `hsl(${hue} 70% 55%)`);
  gradient.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 35%)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
  ctx.beginPath();
  ctx.arc(canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) / 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${Math.round(canvas.height / 8)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`#${id + 1} ${width}×${height}`, canvas.width / 2, canvas.height - canvas.height / 10);
  return { id, src: canvas.toDataURL('image/jpeg', 0.85), width, height };
}

const toRect = (el: Element): Rect => {
  const { top, left, width, height } = el.getBoundingClientRect();
  return { top, left, width, height };
};

const DURATION = 220;

export default function TgGhostDemo() {
  // 30 ảnh để lưới đủ dài, cuộn được (kiểm tra trường hợp ô ảnh đã khuất khi đóng)
  const photos = useMemo(
    () => Array.from({ length: 30 }, (_, i) => makePhoto(i, ...SIZES[i % SIZES.length])),
    [],
  );
  const [open, setOpen] = useState<Photo | null>(null);
  const [imageVisible, setImageVisible] = useState(false);
  const [uncoverOn, setUncoverOn] = useState(true);
  const [slow, setSlow] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const viewerImgRef = useRef<HTMLImageElement>(null);
  const { lines, add } = useLog(20);
  const duration = slow ? 1200 : DURATION;

  const thumbOf = (photo: Photo) => gridRef.current!.querySelector(`[data-photo="${photo.id}"]`)!;

  const viewerRect = (photo: Photo): Rect => {
    const margin = 48;
    const { width, height } = fitInto(photo.width, photo.height, window.innerWidth - 32, window.innerHeight - margin * 2);
    return { width, height, left: (window.innerWidth - width) / 2, top: (window.innerHeight - height) / 2 };
  };

  const openPhoto = (photo: Photo) => {
    setOpen(photo);
    setImageVisible(false);
    const from = toRect(thumbOf(photo));
    void animateOpening(
      { src: photo.src, from, to: viewerRect(photo), natural: { width: photo.width, height: photo.height } },
      { durationMs: duration, shape: uncoverOn ? 'cover' : 'none' },
    ).then(() => {
      // ghost bay xong thì mới hiện ảnh thật trong viewer
      if (!document.querySelector('.tg-ghost')) setImageVisible(true);
    });
    add(`mở #${photo.id + 1}${uncoverOn ? '' : ' (không uncover: ảnh sẽ méo lúc bay)'}`);
  };

  const closePhoto = async () => {
    if (!open) return;
    const photo = open;
    const imgEl = viewerImgRef.current;
    const from = imgEl && imageVisible ? toRect(imgEl) : viewerRect(photo);
    setImageVisible(false);
    setOpen(null);
    const mode = await animateClosing(
      { src: photo.src, from, to: toRect(thumbOf(photo)), viewport: toRect(gridRef.current!) },
      { durationMs: duration, shape: 'cover' },
    );
    const label = {
      return: 'bay về đúng ô',
      'fly-off-top': 'ô đã cuộn khỏi khung ở phía trên: bay ra mép trên',
      'fly-off-bottom': 'ô đã cuộn khỏi khung ở phía dưới: bay ra mép dưới',
      fade: 'ô chỉ thấy một phần: vừa bay vừa mờ dần',
    }[mode];
    add(`đóng #${photo.id + 1}: ${label}`, 'ok');
  };

  const scrollThenClose = () => {
    if (!open) return;
    const grid = gridRef.current!;
    const thumb = thumbOf(open) as HTMLElement;
    // cuộn để ô ảnh nằm ngoài khung nhìn của lưới
    grid.scrollTop = thumb.offsetTop > grid.clientHeight ? 0 : grid.scrollHeight;
    requestAnimationFrame(() => void closePhoto());
  };

  const openThenCloseFast = () => {
    openPhoto(photos[1]);
    // bấm "Đóng" khi ghost mới bay được khoảng 40% quãng đường
    setTimeout(() => {
      add('đóng khi ghost đang bay dở', 'warn');
      document.querySelector<HTMLButtonElement>('[data-close]')?.click();
    }, Math.round(duration * 0.4));
  };

  return (
    <div className='page tgg'>
      <h1>Ảnh bay giữa hai cây DOM</h1>
      <p className='hint'>
        Bấm một ảnh để mở. Ảnh trong lưới bị crop vuông (<code>object-fit: cover</code>), ảnh trong viewer giữ tỉ lệ thật. Trong
        viewer, thử "Cuộn lưới rồi đóng" để thấy ghost bay ra mép thay vì bay tới chỗ không nhìn thấy.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={uncoverOn} onChange={(e) => setUncoverOn(e.target.checked)} /> uncover khung nguồn
        </label>
        <label>
          <input type='checkbox' checked={slow} onChange={(e) => setSlow(e.target.checked)} /> chậm (1,2s)
        </label>
        <button onClick={openThenCloseFast}>Mở rồi đóng ngay khi đang bay</button>
      </div>
      <div ref={gridRef} className='tgg-grid' data-testid='grid'>
        {photos.map((photo) => (
          <button key={photo.id} className='tgg-thumb' data-photo={photo.id} onClick={() => openPhoto(photo)}>
            <img src={photo.src} alt={`Ảnh ${photo.id + 1}`} />
          </button>
        ))}
      </div>
      <Log lines={lines} />
      {open && (
        <div className='tgg-viewer' role='dialog' aria-label={`Ảnh ${open.id + 1}`} onClick={() => void closePhoto()}>
          <img
            ref={viewerImgRef}
            src={open.src}
            alt=''
            style={{ ...viewerRect(open), position: 'fixed', visibility: imageVisible ? 'visible' : 'hidden' }}
          />
          <div className='tgg-bar' onClick={(e) => e.stopPropagation()}>
            <button data-close onClick={() => void closePhoto()}>
              Đóng
            </button>
            <button onClick={scrollThenClose}>Cuộn lưới rồi đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}

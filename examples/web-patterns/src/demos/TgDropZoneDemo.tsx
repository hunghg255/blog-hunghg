import { useEffect, useRef, useState } from 'react';
import { Log, useLog } from './shared';
import {
  QUICK_TYPES,
  copyImageToClipboard,
  copyText,
  createDropHide,
  fitWithin,
  getDropMode,
  squeezeImage,
  type DropMode,
} from '../lib/tgDropZone';
import './TgDropZoneDemo.css';

/** Cách quyết định của bản gốc (mô phỏng, không phải mã Telegram): không kiểm tra có file hay không. */
function getDropModeLikeOriginal(items: Iterable<Pick<DataTransferItem, 'kind' | 'type'>>): DropMode {
  const list = Array.from(items).filter((i) => i.type !== 'text/uri-list');
  return list.every((i) => i.kind === 'file' && QUICK_TYPES.has(i.type)) ? 'quick' : 'document';
}

const MODE_TEXT: Record<DropMode, string> = { none: 'không hiện', document: '1 ô (dạng file)', quick: '2 ô (ảnh + file)' };

// ---------------------------------------------------------------- 1. vùng thả

const PRESETS: { label: string; build: (dt: DataTransfer) => void }[] = [
  {
    label: '2 ảnh JPEG',
    build: (dt) => {
      dt.items.add(new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
      dt.items.add(new File(['x'], 'b.jpg', { type: 'image/jpeg' }));
    },
  },
  {
    label: 'ảnh + PDF',
    build: (dt) => {
      dt.items.add(new File(['x'], 'a.png', { type: 'image/png' }));
      dt.items.add(new File(['x'], 'hop-dong.pdf', { type: 'application/pdf' }));
    },
  },
  {
    label: 'đoạn chữ đang bôi',
    build: (dt) => {
      dt.setData('text/plain', 'Mai họp lúc 9h');
    },
  },
];

function DropSection() {
  const zoneRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<DropMode>('none');
  const [hovered, setHovered] = useState<'document' | 'quick' | null>(null);
  const [rows, setRows] = useState<{ label: string; original: DropMode; fixed: DropMode }[]>([]);
  const log = useLog(8);
  const addLog = log.add;

  useEffect(() => {
    const zone = zoneRef.current!;
    const hide = createDropHide(() => {
      setMode('none');
      addLog('ẩn vùng thả (rời cửa sổ / Esc)', 'muted');
    });
    const onEnter = (e: DragEvent) => {
      e.preventDefault();
      const next = getDropMode(e.dataTransfer?.items);
      setMode((prev) => (prev === next ? prev : next));
    };
    const onOver = (e: DragEvent) => {
      e.preventDefault();
      hide.dragOver();
    };
    const onLeave = (e: DragEvent) => hide.dragLeave(e);
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      hide.cancel();
      const files = Array.from(e.dataTransfer?.files ?? []);
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-target]')?.dataset.target;
      if (files.length) addLog(`thả ${files.length} file vào ô "${target === 'quick' ? 'dạng ảnh' : 'dạng file'}": ${files.map((f) => f.name).join(', ')}`, 'ok');
      setMode('none');
      setHovered(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('none');
    };
    zone.addEventListener('dragenter', onEnter);
    zone.addEventListener('dragover', onOver);
    zone.addEventListener('dragleave', onLeave);
    zone.addEventListener('drop', onDrop);
    window.addEventListener('keydown', onKey);
    return () => {
      hide.cancel();
      zone.removeEventListener('dragenter', onEnter);
      zone.removeEventListener('dragover', onOver);
      zone.removeEventListener('dragleave', onLeave);
      zone.removeEventListener('drop', onDrop);
      window.removeEventListener('keydown', onKey);
    };
  }, [addLog]);

  const simulate = (preset: (typeof PRESETS)[number]) => {
    const dt = new DataTransfer();
    preset.build(dt);
    const items = Array.from(dt.items);
    setRows((r) => [
      { label: preset.label, original: getDropModeLikeOriginal(items), fixed: getDropMode(items) },
      ...r.filter((x) => x.label !== preset.label),
    ]);
    zoneRef.current!.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
  };

  return (
    <section className='tgd-section'>
      <h2>1. Một ô hay hai ô, quyết định ngay lúc dragenter</h2>
      <p className='hint'>
        Kéo file từ máy vào khung chat bên dưới (ảnh JPEG/PNG thì có 2 ô, file khác 1 ô), hoặc bấm các nút giả lập. Lúc{' '}
        <code>dragenter</code> trình duyệt chưa cho đọc file nhưng đã cho biết <code>kind</code> và MIME.
      </p>
      <div className='toolbar'>
        {PRESETS.map((p) => (
          <button key={p.label} onClick={() => simulate(p)}>
            Giả lập kéo: {p.label}
          </button>
        ))}
        <button onClick={() => setMode('none')}>Đóng vùng thả</button>
      </div>
      <div ref={zoneRef} className='tgd-zone' data-testid='tgd-zone'>
        <div className='tgd-chat'>
          <div className='tgd-msg'>Kéo file vào đây để gửi</div>
        </div>
        {mode !== 'none' && (
          <div className='tgd-drop' data-testid='tgd-drop' data-mode={mode}>
            <div
              className={`tgd-target ${hovered === 'document' ? 'hovered' : ''}`}
              data-target='document'
              onDragEnter={() => setHovered('document')}
              onDragLeave={() => setHovered(null)}
            >
              📄 Thả vào đây để gửi <b>dạng file</b>
              <small>không nén</small>
            </div>
            {mode === 'quick' && (
              <div
                className={`tgd-target ${hovered === 'quick' ? 'hovered' : ''}`}
                data-target='quick'
                onDragEnter={() => setHovered('quick')}
                onDragLeave={() => setHovered(null)}
              >
                🖼 Thả vào đây để gửi <b>dạng ảnh</b>
                <small>nén nhanh</small>
              </div>
            )}
          </div>
        )}
      </div>
      {rows.length > 0 && (
        <table className='tgd-table'>
          <thead>
            <tr>
              <th>Kéo vào</th>
              <th>Kiểu bản gốc</th>
              <th>Bản sửa</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td className={r.original !== r.fixed ? 'err' : ''}>{MODE_TEXT[r.original]}</td>
                <td data-testid={`tgd-fixed-${r.label}`}>{MODE_TEXT[r.fixed]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 2. nén ảnh

interface Sample {
  key: string;
  label: string;
  make: () => Promise<Blob>;
}

function canvasBlob(w: number, h: number, type: string, draw: (ctx: CanvasRenderingContext2D) => void, quality?: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), type, quality));
}

const drawPhoto = (w: number, h: number) => (ctx: CanvasRenderingContext2D) => {
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, '#2aabee');
  g.addColorStop(1, '#f2c14e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // nhiễu nhẹ để giống ảnh chụp, JPEG không nén "quá dễ"
  for (let i = 0; i < 4000; i++) {
    ctx.fillStyle = `hsla(${(i * 37) % 360} 60% 50% / 0.25)`;
    ctx.fillRect((i * 997) % w, (i * 631) % h, 12, 12);
  }
};

const SAMPLES: Sample[] = [
  { key: 'big', label: 'Ảnh chụp PNG 4000×3000', make: () => canvasBlob(4000, 3000, 'image/png', drawPhoto(4000, 3000)) },
  {
    key: 'logo',
    label: 'Logo PNG trong suốt 600×600',
    make: () =>
      canvasBlob(600, 600, 'image/png', (ctx) => {
        ctx.fillStyle = '#2aabee';
        ctx.beginPath();
        ctx.arc(300, 300, 220, 0, Math.PI * 2);
        ctx.fill();
      }),
  },
  { key: 'jpeg', label: 'JPEG 1000×750', make: () => canvasBlob(1000, 750, 'image/jpeg', drawPhoto(1000, 750), 0.9) },
];

interface SqueezeRow {
  label: string;
  inSize: string;
  original: string;
  originalCorner?: string;
  fixed: string;
  previewOriginal?: string;
  previewFixed?: string;
}

const kb = (n: number) => `${(n / 1024).toFixed(0)} KB`;

async function cornerColor(blob: Blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, 1, 1, 0, 0, 1, 1);
  bmp.close();
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/** Mô phỏng cách nén của bản gốc: luôn vẽ lại và xuất JPEG với quality = 100. */
async function squeezeLikeOriginal(file: Blob) {
  const bmp = await createImageBitmap(file);
  const { width, height } = fitWithin(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  c.getContext('2d')!.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/jpeg', 100));
}

function SqueezeSection() {
  const [rows, setRows] = useState<SqueezeRow[]>([]);
  const [qualityTest, setQualityTest] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    const out: SqueezeRow[] = [];
    for (const s of SAMPLES) {
      const input = await s.make();
      const orig = await squeezeLikeOriginal(input);
      const fixed = await squeezeImage(input);
      out.push({
        label: s.label,
        inSize: kb(input.size),
        original: `${kb(orig.size)} JPEG`,
        originalCorner: await cornerColor(orig),
        fixed: fixed.asPhoto ? `${kb(fixed.blob.size)} JPEG ${fixed.width}×${fixed.height}` : 'gửi dạng file (có trong suốt)',
        previewOriginal: URL.createObjectURL(orig),
        previewFixed: fixed.asPhoto ? URL.createObjectURL(fixed.blob) : URL.createObjectURL(input),
      });
    }
    setRows(out);

    // quality = 100 nằm ngoài [0, 1] nên bị bỏ qua: kích thước bằng đúng lúc không truyền quality
    const photo = drawPhoto(1280, 960);
    const [q100, qDefault, q1] = await Promise.all([
      canvasBlob(1280, 960, 'image/jpeg', photo, 100),
      canvasBlob(1280, 960, 'image/jpeg', photo),
      canvasBlob(1280, 960, 'image/jpeg', photo, 1),
    ]);
    setQualityTest(`quality 100: ${kb(q100.size)} · không truyền: ${kb(qDefault.size)} · quality 1: ${kb(q1.size)}`);
    setBusy(false);
  };

  return (
    <section className='tgd-section'>
      <h2>2. Nén ảnh trước khi gửi</h2>
      <p className='hint'>
        Gửi dạng ảnh: cạnh dài tối đa 1280px, xuất JPEG. Bản gốc truyền <code>quality = 100</code> (ngoài khoảng 0..1)
        và nén cả PNG trong suốt thành JPEG.
      </p>
      <div className='toolbar'>
        <button className='primary' disabled={busy} onClick={run}>
          {busy ? 'Đang nén…' : 'Chạy 3 ảnh mẫu'}
        </button>
      </div>
      {qualityTest && (
        <p className='muted' data-testid='tgd-quality'>
          {qualityTest}
        </p>
      )}
      {rows.length > 0 && (
        <div className='tgd-squeeze'>
          {rows.map((r) => (
            <div key={r.label} className='card'>
              <b>{r.label}</b> <span className='muted'>({r.inSize})</span>
              <div className='tgd-previews'>
                <figure>
                  <img src={r.previewOriginal} alt='' />
                  <figcaption>
                    Kiểu bản gốc: {r.original}
                    <br />
                    góc ảnh: <span data-testid='tgd-corner'>{r.originalCorner}</span>
                  </figcaption>
                </figure>
                <figure>
                  <img src={r.previewFixed} alt='' />
                  <figcaption>Bản sửa: {r.fixed}</figcaption>
                </figure>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- 3. copy

function CopySection() {
  const log = useLog(6);

  const copyImg = async () => {
    try {
      const jpeg = await canvasBlob(240, 160, 'image/jpeg', drawPhoto(240, 160), 0.9);
      await copyImageToClipboard(jpeg);
      log.add('đã copy ảnh (JPEG → PNG), dán vào ô bên dưới hoặc app khác', 'ok');
    } catch (err) {
      log.add(`không copy được ảnh: ${(err as Error).message}`, 'err');
    }
  };

  const copyTxt = async () => {
    await copyText('Xin chào từ Telegram 👋');
    log.add('đã copy chữ', 'ok');
  };

  return (
    <section className='tgd-section'>
      <h2>3. Copy ảnh và chữ</h2>
      <div className='toolbar'>
        <button onClick={copyImg}>Copy ảnh</button>
        <button onClick={copyTxt}>Copy chữ</button>
      </div>
      <div className='tgd-paste' contentEditable suppressContentEditableWarning data-testid='tgd-paste' aria-label='Ô thử dán'>
        Dán thử vào đây (Ctrl+V)
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

export default function TgDropZoneDemo() {
  return (
    <div className='page tgd'>
      <h1>Telegram: vùng thả file, nén ảnh, copy ảnh</h1>
      <DropSection />
      <SqueezeSection />
      <CopySection />
    </div>
  );
}

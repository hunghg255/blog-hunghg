import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { sniffFile, type SniffResult } from '../lib/fileSniff';
import { orientationTransform, readOrientation, swapsDimensions, type Orientation } from '../lib/fileSniffExif';
import { readPaste } from '../lib/fileSniffPaste';
import { Log, useLog } from './shared';
import './FileSniffDemo.css';

// ---- tạo file mẫu ngay trong trình duyệt ----

/** Vẽ một ảnh có mũi tên "TRÊN" để nhìn là biết ảnh đang xoay đúng hay sai. */
function drawSample(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 100;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ff7a3d';
  ctx.fillRect(0, 0, 160, 100);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('↑ TRÊN', 80, 40);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('160×100', 80, 75);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), type, 0.9));

/** Chèn segment APP1/EXIF chỉ chứa tag Orientation ngay sau SOI (FF D8) của một JPEG. */
async function withOrientation(jpeg: Blob, orientation: Orientation): Promise<Blob> {
  const src = new Uint8Array(await jpeg.arrayBuffer());
  const app1 = new Uint8Array([
    0xff, 0xe1, 0x00, 0x22, // APP1, độ dài 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 ở offset 8
    0x00, 0x01, // 1 tag
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation (SHORT)
    0x00, 0x00, 0x00, 0x00, // không có IFD tiếp theo
  ]);
  return new Blob([src.slice(0, 2), app1, src.slice(2)], { type: 'image/jpeg' });
}

interface Inspected {
  name: string;
  sniff: SniffResult;
  orientation: Orientation | null;
  url: string | null;
}

export default function FileSniffDemo() {
  const { lines, add } = useLog();
  const [inspected, setInspected] = useState<Inspected | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => () => void (urlRef.current && URL.revokeObjectURL(urlRef.current)), []);

  async function inspect(file: File) {
    const sniff = await sniffFile(file);
    const orientation = sniff.type === 'image/jpeg' ? await readOrientation(file) : null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = sniff.type ? URL.createObjectURL(file) : null;
    setInspected({ name: file.name, sniff, orientation, url: urlRef.current });
    add(
      `${file.name}: khai báo "${sniff.declaredType || '(trống)'}", nội dung thật ${sniff.type ?? 'không phải ảnh'}` +
        (orientation ? `, EXIF orientation ${orientation}` : ''),
      sniff.mismatch ? 'err' : sniff.type ? 'ok' : 'warn',
    );
  }

  const samples: Array<[string, () => Promise<File>]> = [
    ['JPEG thật', async () => new File([await toBlob(drawSample(), 'image/jpeg')], 'photo.jpg', { type: 'image/jpeg' })],
    ['PNG đặt tên .jpg', async () => new File([await toBlob(drawSample(), 'image/png')], 'avatar.jpg', { type: 'image/jpeg' })],
    ['Text đổi tên .png', async () => new File(['MZ… đây không phải ảnh'], 'virus.png', { type: 'image/png' })],
    [
      'JPEG chụp dọc (EXIF 6)',
      async () =>
        new File([await withOrientation(await toBlob(drawSample(), 'image/jpeg'), 6)], 'iphone.jpg', { type: 'image/jpeg' }),
    ],
  ];

  async function simulatePaste() {
    // Giả lập Ctrl+V một ảnh: DataTransfer + ClipboardEvent tự tạo (Chrome, Edge, Firefox)
    const dt = new DataTransfer();
    dt.items.add(new File([await toBlob(drawSample(), 'image/png')], 'screenshot.png', { type: 'image/png' }));
    const event = new window.ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    document.querySelector('.fs-paste')?.dispatchEvent(event);
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const result = readPaste(event.clipboardData);
    if (result.kind === 'files') {
      add(`Dán được ${result.files.length} ảnh (${result.files.map((f) => f.type).join(', ')})`, 'ok');
      void inspect(result.files[0]);
    } else if (result.kind === 'image-url') add(`Dán ảnh từ web: chỉ có URL ${result.url}`, 'warn');
    else if (result.kind === 'text') add(`Dán chữ: "${result.text.slice(0, 40)}"`, 'muted');
    else add(result.reason, 'err');
  }

  const o = inspected?.orientation ?? null;
  const swap = swapsDimensions(o);

  return (
    <div className='page'>
      <h1>Magic number, EXIF và dán ảnh</h1>
      <p className='hint'>
        Chọn file thật trên máy, bấm tạo file mẫu, hoặc dán ảnh (Ctrl/⌘+V) vào ô bên dưới. Loại file được nhận từ vài byte
        đầu, không tin đuôi file.
      </p>
      <div className='toolbar'>
        <label className='btn'>
          Chọn file…
          <input type='file' hidden onChange={(e) => e.target.files?.[0] && void inspect(e.target.files[0])} />
        </label>
        {samples.map(([label, make]) => (
          <button key={label} onClick={async () => void inspect(await make())}>
            {label}
          </button>
        ))}
      </div>

      {inspected && (
        <div className='card fs-result'>
          <div>
            <b>{inspected.name}</b>{' '}
            <span className={`badge ${inspected.sniff.mismatch || !inspected.sniff.type ? 'err' : 'ok'}`}>
              {inspected.sniff.mismatch ? 'đuôi file nói dối' : inspected.sniff.type ? 'hợp lệ' : 'không phải ảnh'}
            </span>
          </div>
          <div className='muted'>
            khai báo: {inspected.sniff.declaredType || '(trống)'} · thật: {inspected.sniff.type ?? '?'} · orientation:{' '}
            {o ?? 'không có'}
          </div>
          {inspected.url && (
            <div className='fs-previews'>
              <figure>
                <div className='fs-box'>
                  <img src={inspected.url} alt='' style={{ imageOrientation: 'none' }} />
                </div>
                <figcaption>Pixel thô (image-orientation: none)</figcaption>
              </figure>
              <figure>
                <div className='fs-box'>
                  <img src={inspected.url} alt='' />
                </div>
                <figcaption>Mặc định: trình duyệt tự xoay theo EXIF</figcaption>
              </figure>
              <figure>
                <div className='fs-box'>
                  <img src={inspected.url} alt='' style={{ transform: orientationTransform(o) }} />
                </div>
                <figcaption className={o && o !== 1 ? 'err' : undefined}>
                  Tự xoay thêm bằng code{o && o !== 1 ? ': xoay 2 lần!' : ''}
                  {swap ? ' (đổi rộng/cao)' : ''}
                </figcaption>
              </figure>
            </div>
          )}
        </div>
      )}

      <div className='fs-paste' contentEditable suppressContentEditableWarning onPaste={onPaste} tabIndex={0}>
        Bấm vào đây rồi dán ảnh (Ctrl/⌘+V)…
      </div>
      <div className='toolbar'>
        <button onClick={() => void simulatePaste()}>Giả lập dán ảnh chụp màn hình</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}

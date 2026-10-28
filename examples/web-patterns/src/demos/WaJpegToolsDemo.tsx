import { useEffect, useRef, useState } from 'react';
import {
  canvasToBlob,
  encodeWithinBudget,
  generateMicroThumb,
  gridSamplePoints,
  isBlackFrame,
  listJpegSegments,
  readExifSummary,
  stripJpegMetadata,
  type ExifSummary,
  type JpegSegment,
} from '../lib/waJpegTools';
import { Stat } from './shared';
import './WaJpegToolsDemo.css';

const fmt = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** cleanJPEG gốc: gặp APP2..APP15 (trừ APP13) là throw, kể cả ICC profile. */
function originalCleanWouldThrow(segs: JpegSegment[]): string | null {
  const bad = segs.find((s) => s.marker >= 0xe2 && s.marker <= 0xef && s.marker !== 0xed);
  return bad ? `Received unexpected APP marker 0x${bad.marker.toString(16)}` : null;
}

/** Bộ kiểm frame đen gốc: 5 điểm mẫu, tất cả nằm trong 1/4 đầu mảng điểm ảnh. */
function originalSamplePoints(w: number, h: number): [number, number][] {
  const t = (w * h) / 4;
  const pts: [number, number][] = [];
  for (let a = 0; a <= 1; a += 0.25) {
    const p = Math.round(t * a);
    pts.push([p % w, Math.floor(p / w)]);
  }
  return pts;
}
function originalIsBlack(img: ImageData): boolean {
  return originalSamplePoints(img.width, img.height).every(([x, y]) => {
    const i = 4 * (y * img.width + x);
    const a = img.data[i + 3];
    return !img.data[i] && !img.data[i + 1] && !img.data[i + 2] && (a === 0 || a === 255);
  });
}

/** getResizedDataUrl gốc: encode mặc định 2 lần, rồi thử 0.9, 0.8, … 0.1. */
async function originalBudget(canvas: HTMLCanvasElement, max: number) {
  let encodes = 1;
  const first = canvas.toDataURL('image/jpeg');
  const size = (url: string) => atob(url.split(',')[1]).length;
  if (size(first) <= max) return { encodes: 2, quality: 0.92, size: size(canvas.toDataURL('image/jpeg')) };
  for (let r = 0.9; r >= 0.1; r -= 0.1) {
    encodes++;
    const url = canvas.toDataURL('image/jpeg', r);
    if (size(url) <= max) return { encodes, quality: r, size: size(url) };
  }
  return { encodes, quality: null, size: null };
}

async function decodePixels(bytes: Uint8Array<ArrayBuffer>) {
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height).data;
}

function diffCount(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  let n = 0;
  for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) n++;
  return n;
}

interface StripState {
  segs: JpegSegment[];
  exif: ExifSummary | null;
  size: number;
  after?: { size: number; removed: JpegSegment[]; diff: number; reencode: number; reencodeDiff: number; url: string };
  originalError: string | null;
}

export default function WaJpegToolsDemo() {
  const [withIcc, setWithIcc] = useState(false);
  const [strip, setStrip] = useState<StripState>();
  const [budget, setBudget] = useState(8000);
  const [budgetOut, setBudgetOut] = useState<{ wa: Awaited<ReturnType<typeof originalBudget>>; ours: string; url?: string; micro: string; microUrl: string }>();
  const [frame, setFrame] = useState<'letterbox' | 'black' | 'normal'>('letterbox');
  const frameRef = useRef<HTMLCanvasElement>(null);
  const [frameResult, setFrameResult] = useState({ wa: false, ours: false });
  const source = useRef<Uint8Array<ArrayBuffer>>(undefined);

  async function load() {
    if (!source.current) source.current = new Uint8Array(await (await fetch('./wa-exif.jpg')).arrayBuffer());
    let bytes = source.current;
    if (withIcc) {
      // Chèn một APP2 ICC_PROFILE (rút gọn) như ảnh chụp từ điện thoại có màu Display P3.
      const payload = new TextEncoder().encode('ICC_PROFILE\0\x01\x01demo-profile');
      const seg = new Uint8Array([0xff, 0xe2, 0, payload.length + 2, ...payload]);
      bytes = new Uint8Array([...bytes.subarray(0, 2), ...seg, ...bytes.subarray(2)]);
    }
    const segs = listJpegSegments(bytes);
    setStrip({ segs, exif: readExifSummary(bytes), size: bytes.byteLength, originalError: originalCleanWouldThrow(segs) });
    return bytes;
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withIcc]);

  async function runStrip() {
    const bytes = await load();
    const { bytes: out, removed } = stripJpegMetadata(bytes);
    const [a, b] = await Promise.all([decodePixels(bytes), decodePixels(out)]);
    // So với cách "vẽ lên canvas rồi xuất lại": mất metadata nhưng cũng đổi điểm ảnh.
    const bmp = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const re = new Uint8Array(await (await canvasToBlob(c, 'image/jpeg', 0.92))!.arrayBuffer());
    const r = await decodePixels(re);
    setStrip((s) =>
      s && {
        ...s,
        after: {
          size: out.byteLength,
          removed,
          diff: diffCount(a, b),
          reencode: re.byteLength,
          reencodeDiff: diffCount(a, r),
          url: URL.createObjectURL(new Blob([out], { type: 'image/jpeg' })),
        },
      },
    );
  }

  async function runBudget() {
    const bmp = await createImageBitmap(new Blob([await load()]));
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    const wa = await originalBudget(c, budget);
    const ours = await encodeWithinBudget(c, budget);
    const micro = await generateMicroThumb(c, 1300, { mimetype: 'image/webp' });
    setBudgetOut({
      wa,
      ours: ours ? `${ours.encodes} lần encode, q=${ours.quality.toFixed(2)}, ${fmt(ours.blob.size)}` : 'không vừa: cần thu nhỏ',
      url: ours ? URL.createObjectURL(ours.blob) : undefined,
      micro: `${micro.width}×${micro.height}, ${fmt(micro.blob.size)} (${micro.blob.type}), ${micro.attempts} lần thu nhỏ`,
      microUrl: URL.createObjectURL(micro.blob),
    });
  }

  useEffect(() => {
    const c = frameRef.current!;
    const ctx = c.getContext('2d')!;
    const { width: w, height: h } = c;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (frame !== 'black') {
      const top = frame === 'letterbox' ? h * 0.3 : 0;
      const g = ctx.createLinearGradient(0, top, w, h - top);
      g.addColorStop(0, '#0b8f52');
      g.addColorStop(1, '#f2c14e');
      ctx.fillStyle = g;
      ctx.fillRect(0, top, w, h - 2 * top);
    }
    const img = ctx.getImageData(0, 0, w, h);
    setFrameResult({ wa: originalIsBlack(img), ours: isBlackFrame(img) });
    for (const [pts, color] of [
      [gridSamplePoints(w, h), '#ffffff'],
      [originalSamplePoints(w, h), '#f2466b'],
    ] as const) {
      ctx.fillStyle = color;
      for (const [x, y] of pts) ctx.fillRect(x - 3, y - 3, 6, 6);
    }
  }, [frame]);

  return (
    <div className='page wa-jpeg'>
      <h1>WhatsApp #3: xoá EXIF không re-encode, thumbnail theo ngân sách byte</h1>
      <p className='hint'>Ảnh mẫu có Exif (hãng máy, GPS) và một comment. Mọi xử lý chạy trong trình duyệt.</p>

      <section className='card'>
        <h2>1. Xoá metadata bằng cách chép segment</h2>
        <div className='toolbar'>
          <button className='primary' onClick={runStrip} data-testid='strip'>
            Xoá metadata
          </button>
          <label className='switch'>
            <input type='checkbox' checked={withIcc} onChange={(e) => setWithIcc(e.target.checked)} data-testid='icc' />
            Ảnh có APP2 ICC profile (điện thoại)
          </label>
        </div>
        {strip && (
          <>
            <p className='hint'>
              Exif: {strip.exif ? `${strip.exif.make ?? '?'} ${strip.exif.model ?? ''}, orientation ${strip.exif.orientation}` : 'không có'}
              {strip.exif?.hasGps && <b className='err'> · có toạ độ GPS</b>}
            </p>
            <div className='wa-jpeg-segs'>
              {strip.segs.map((s) => (
                <span key={s.offset} className={strip.after?.removed.some((r) => r.offset === s.offset) ? 'gone' : ''}>
                  {s.name}
                  {s.tag ? ` ${s.tag}` : ''} <small>{fmt(s.size)}</small>
                </span>
              ))}
            </div>
            <p className={strip.originalError ? 'err' : 'ok'} data-testid='orig'>
              cleanJPEG gốc: {strip.originalError ? `throw "${strip.originalError}" → rơi về vẽ lại trên canvas` : 'chạy được'}
            </p>
            {strip.after && (
              <div className='stats'>
                <Stat label='trước' value={fmt(strip.size)} />
                <Stat label='sau khi chép segment' value={fmt(strip.after.size)} />
                <Stat label='điểm ảnh khác (chép segment)' value={<bdi data-testid='diff'>{strip.after.diff}</bdi>} />
                <Stat label='re-encode canvas q=0.92' value={fmt(strip.after.reencode)} />
                <Stat label='điểm ảnh khác (re-encode)' value={strip.after.reencodeDiff} />
              </div>
            )}
          </>
        )}
      </section>

      <section className='card'>
        <h2>2. Thumbnail vừa ngân sách byte</h2>
        <div className='toolbar'>
          <label>
            Ngân sách{' '}
            <select value={budget} onChange={(e) => setBudget(+e.target.value)}>
              <option value={20000}>20 000 B (ngưỡng thumbnail của WhatsApp)</option>
              <option value={8000}>8 000 B</option>
              <option value={3000}>3 000 B</option>
            </select>
          </label>
          <button className='primary' onClick={runBudget} data-testid='budget'>
            Nén
          </button>
        </div>
        {budgetOut && (
          <div className='wa-jpeg-budget'>
            <div>
              <b>Vòng lặp gốc</b>
              <p>
                {budgetOut.wa.encodes} lần encode,{' '}
                {budgetOut.wa.quality == null ? 'trả null' : `q=${budgetOut.wa.quality.toFixed(2)}, ${fmt(budgetOut.wa.size!)}`}
              </p>
            </div>
            <div>
              <b>Tìm nhị phân</b>
              <p data-testid='ours'>{budgetOut.ours}</p>
              {budgetOut.url && <img src={budgetOut.url} alt='Thumbnail trong ngân sách' />}
            </div>
            <div>
              <b>Micro-thumb 1300 B, mimetype webp</b>
              <p>{budgetOut.micro}</p>
              <img src={budgetOut.microUrl} alt='Micro thumbnail' className='micro' />
            </div>
          </div>
        )}
      </section>

      <section className='card'>
        <h2>3. Frame đầu video có đen không?</h2>
        <div className='toolbar'>
          {(['letterbox', 'black', 'normal'] as const).map((f) => (
            <button key={f} className={frame === f ? 'primary' : ''} onClick={() => setFrame(f)}>
              {f === 'letterbox' ? 'Video có viền đen' : f === 'black' ? 'Frame đen thật' : 'Frame bình thường'}
            </button>
          ))}
        </div>
        <div className='wa-jpeg-frame'>
          <canvas ref={frameRef} width={320} height={180} />
          <div>
            <p className={frameResult.wa ? 'err' : 'ok'} data-testid='wa-black'>
              <i className='dot red' /> 5 điểm gốc: {frameResult.wa ? 'đen → thử lại 100 × 50 ms' : 'không đen'}
            </p>
            <p className={frameResult.ours ? 'err' : 'ok'}>
              <i className='dot white' /> lưới 6×6: {frameResult.ours ? 'đen → thử lại' : 'không đen'}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

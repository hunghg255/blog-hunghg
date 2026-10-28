import { useEffect, useState } from 'react';
import {
  buildAnimatedWebp,
  chunk,
  parseLikeOriginal,
  parseWebpSticker,
  stickerJsonPayload,
  walkChunks,
  type BuildFrame,
  type RiffChunk,
} from '../lib/waWebpMeta';
import './WaWebpStickerDemo.css';

const SIZE = 160;
const EMOJIS = ['😀', '🎉', '👍'];

/** Vẽ một frame, encode WebP bằng canvas rồi lấy các chunk ảnh (VP8/VP8L/ALPH) để nhét vào ANMF. */
async function drawFrame(i: number, count: number): Promise<{ image: Uint8Array; real: boolean }> {
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#e7fbe9';
  ctx.fillRect(0, 0, SIZE, SIZE);
  const y = SIZE / 2 + Math.sin((i / count) * Math.PI * 2) * 28;
  ctx.fillStyle = `hsl(${140 + i * 25} 70% 45%)`;
  ctx.beginPath();
  ctx.arc(SIZE / 2, y, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 40px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(i + 1), SIZE / 2, y);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.8));
  const bytes = blob ? new Uint8Array(await blob.arrayBuffer()) : new Uint8Array(0);
  if (blob?.type !== 'image/webp') return { image: chunk('VP8L', new Uint8Array(64)), real: false };
  const parts = walkChunks(bytes).filter((ch) => ['VP8 ', 'VP8L', 'ALPH'].includes(ch.fourcc));
  const image = new Uint8Array(parts.reduce((n, p) => n + 8 + p.size + (p.size & 1), 0));
  let at = 0;
  for (const p of parts) {
    const len = 8 + p.size + (p.size & 1);
    image.set(bytes.subarray(p.offset, p.offset + len), at);
    at += len;
  }
  return { image, real: true };
}

interface Built {
  url: string;
  real: boolean;
  size: number;
  chunks: RiffChunk[];
  ours: ReturnType<typeof parseWebpSticker>;
  wa: ReturnType<typeof parseLikeOriginal>;
}

export default function WaWebpStickerDemo() {
  const [iccp, setIccp] = useState(true);
  const [where, setWhere] = useState<'EXIF' | 'XMP '>('EXIF');
  const [count, setCount] = useState(6);
  const [built, setBuilt] = useState<Built>();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const frames: BuildFrame[] = [];
      let real = true;
      for (let i = 0; i < count; i++) {
        const f = await drawFrame(i, count);
        real &&= f.real;
        frames.push({ width: SIZE, height: SIZE, duration: i % 2 ? 120 : 200, image: f.image });
      }
      const meta = stickerJsonPayload({ 'sticker-pack-id': 'demo-pack', emojis: EMOJIS });
      const file = buildAnimatedWebp(frames, {
        // ICC giả 64 byte: đủ để chiếm chỗ giữa VP8X và ANIM như file thật
        iccp: iccp ? new Uint8Array(64).fill(0x2a) : undefined,
        exif: where === 'EXIF' ? meta : undefined,
        xmp: where === 'XMP ' ? meta : undefined,
      });
      if (cancelled) return;
      setBuilt((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return {
          url: URL.createObjectURL(new Blob([file], { type: 'image/webp' })),
          real,
          size: file.byteLength,
          chunks: walkChunks(file),
          ours: parseWebpSticker(file),
          wa: parseLikeOriginal(file),
        };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [iccp, where, count]);

  const rows: [string, (m: Built['ours'] | Built['wa']) => string][] = [
    ['1 vòng', (m) => `${m.singleLoopDuration} ms`],
    ['thời lượng phát', (m) => `${m.animationDuration} ms`],
    ['frame đầu kết thúc ở byte', (m) => (m.firstFrameLength == null ? 'không có' : String(m.firstFrameLength))],
    ['emoji', (m) => (m.emojis.length ? m.emojis.join(' ') : 'không có')],
  ];

  return (
    <div className='page wa-webp'>
      <h1>WhatsApp #4: đọc metadata sticker WebP động</h1>
      <p className='hint'>
        Sticker được dựng ngay trong trình duyệt: canvas encode từng frame thành WebP, rồi ghép chunk VP8X, ICCP, ANIM,
        ANMF và EXIF/XMP bằng tay. Hai cột đọc cùng một file.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={iccp} onChange={(e) => setIccp(e.target.checked)} data-testid='iccp' />
          Có chunk ICCP
        </label>
        <label>
          Emoji nằm trong{' '}
          <select value={where} onChange={(e) => setWhere(e.target.value as 'EXIF' | 'XMP ')} data-testid='where'>
            <option value='EXIF'>EXIF</option>
            <option value='XMP '>XMP</option>
          </select>
        </label>
        <label>
          Số frame{' '}
          <select value={count} onChange={(e) => setCount(+e.target.value)}>
            {[2, 6, 12, 30].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      {built && (
        <div className='wa-webp-grid'>
          <div className='card wa-webp-preview'>
            <img src={built.url} alt='Sticker WebP động vừa dựng' width={SIZE} height={SIZE} />
            <small className='muted'>
              {(built.size / 1024).toFixed(1)} KB{built.real ? '' : ' · trình duyệt không encode được WebP, frame là byte giả'}
            </small>
          </div>
          <table className='wa-webp-table'>
            <thead>
              <tr>
                <th />
                <th>Bản gốc (offset 44)</th>
                <th>Đi theo chunk</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([label, f]) => (
                <tr key={label}>
                  <th>{label}</th>
                  <td className={f(built.wa) !== f(built.ours) ? 'err' : ''} data-testid={`wa-${label}`}>
                    {f(built.wa)}
                  </td>
                  <td className='ok'>{f(built.ours)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className='wa-webp-chunks'>
            {built.chunks.map((c) => (
              <span key={c.offset} className={c.offset === 44 ? 'at44' : ''}>
                <b>{c.fourcc.trim()}</b> @{c.offset} <small>{c.size} B</small>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

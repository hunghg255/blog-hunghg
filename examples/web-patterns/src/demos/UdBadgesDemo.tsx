import { useEffect, useRef, useState } from 'react';
import { bakePng, OB_NAMESPACE, readBadge, readPngChunks, type BadgeAssertion } from '../lib/udOpenBadges';
import { readPngUdemyStyle, readSvgUdemyStyle } from './UdBadgesUdemyStyle';
import './UdBadgesDemo.css';

const ASSERTION = {
  '@context': 'https://w3id.org/openbadges/v2',
  type: 'Assertion',
  id: 'https://example.org/assertions/7f3c',
  recipient: { type: 'email', hashed: true, identity: 'sha256$c7ef…' },
  badge: 'https://example.org/badges/react-co-ban',
  verify: { type: 'hosted' },
  issuedOn: '2026-10-27T10:00:00Z',
};

type Variant = 'plain' | 'lang' | 'deflate' | 'svg-ob' | 'svg-prefix';

const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'plain', label: 'PNG: iTXt chuẩn' },
  { id: 'lang', label: 'PNG: iTXt có language tag "vi"' },
  { id: 'deflate', label: 'PNG: iTXt nén deflate' },
  { id: 'svg-ob', label: 'SVG: tiền tố openbadges:' },
  { id: 'svg-prefix', label: 'SVG: tiền tố ob: (cùng namespace)' },
];

function drawBadge(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 160, 160);
  g.addColorStop(0, '#a435f0');
  g.addColorStop(1, '#5624d0');
  ctx.clearRect(0, 0, 160, 160);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(80, 80, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('React', 80, 76);
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText('cơ bản', 80, 100);
}

function svgBadge(prefix: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:${prefix}="${OB_NAMESPACE}" width="160" height="160">
  <${prefix}:assertion verify="${ASSERTION.id}"><![CDATA[${JSON.stringify(ASSERTION)}]]></${prefix}:assertion>
  <circle cx="80" cy="80" r="74" fill="#a435f0"/>
  <text x="80" y="88" text-anchor="middle" fill="#fff" font-size="22">React</text>
</svg>`;
}

interface Result {
  ours: string;
  udemy: string;
  chunks?: string;
}

function describe(a: BadgeAssertion) {
  return `${a.source} · ${a.kind} · ${a.verifyUrl ?? '(không có URL)'}`;
}

export default function UdBadgesDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [variant, setVariant] = useState<Variant>('plain');
  const [file, setFile] = useState<Blob | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (canvasRef.current) drawBadge(canvasRef.current);
  }, []);

  // tạo file mẫu theo biến thể đang chọn
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let blob: Blob;
      if (variant.startsWith('svg')) {
        blob = new Blob([svgBadge(variant === 'svg-ob' ? 'openbadges' : 'ob')], { type: 'image/svg+xml' });
      } else {
        const canvas = canvasRef.current!;
        drawBadge(canvas);
        const png = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
        blob = await bakePng(await png.arrayBuffer(), JSON.stringify(ASSERTION), {
          languageTag: variant === 'lang' ? 'vi' : '',
          compress: variant === 'deflate',
        });
      }
      if (!cancelled) setFile(blob);
    })();
    return () => {
      cancelled = true;
    };
  }, [variant]);

  useEffect(() => {
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    let cancelled = false;
    (async () => {
      const r: Result = { ours: '', udemy: '' };
      try {
        r.ours = describe(await readBadge(file));
      } catch (e) {
        r.ours = `Lỗi: ${(e as Error).message}`;
      }
      try {
        if (file.type === 'image/svg+xml') r.udemy = `svg · url · ${readSvgUdemyStyle(await file.text())}`;
        else if (file.type === 'image/png') {
          const buf = await file.arrayBuffer();
          r.udemy = `png · id · ${readPngUdemyStyle(buf)}`;
          r.chunks = readPngChunks(buf)
            .map((c) => `${c.type}(${c.data.length}B${c.crcOk ? '' : ', CRC sai'})`)
            .join(' → ');
        } else r.udemy = `Không xử lý loại "${file.type || 'không rõ'}"`;
      } catch (e) {
        r.udemy = `Lỗi: ${(e as Error).message}`;
      }
      if (!cancelled) setResult(r);
    })();
    return () => {
      cancelled = true;
      URL.revokeObjectURL(u);
    };
  }, [file]);

  return (
    <div className='page ud-badges'>
      <h1>Open Badges giấu trong ảnh</h1>
      <p className='hint'>
        Chọn một cách "nướng" (bake) assertion vào ảnh, hoặc thả ảnh badge của bạn. Bên trái là cách đọc kiểu Udemy
        (mô phỏng), bên phải là bản viết lại.
      </p>
      <div className='toolbar' role='group' aria-label='Biến thể'>
        {VARIANTS.map((v) => (
          <button key={v.id} className={variant === v.id ? 'primary' : ''} onClick={() => setVariant(v.id)} data-variant={v.id}>
            {v.label}
          </button>
        ))}
      </div>
      <div className='ud-badges-row'>
        <div className='ud-badges-img'>
          <canvas ref={canvasRef} width={160} height={160} hidden />
          {url && <img src={url} alt='Badge mẫu' width={120} height={120} />}
          {url && (
            <a href={url} download={variant.startsWith('svg') ? 'badge.svg' : 'badge.png'}>
              Tải ảnh này
            </a>
          )}
          <label className='ud-badges-file'>
            Hoặc chọn file
            <input type='file' accept='image/png,image/svg+xml' onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
          </label>
        </div>
        <div className='ud-badges-out'>
          {result?.chunks && (
            <p className='muted ud-badges-chunks' data-testid='chunks'>
              {result.chunks}
            </p>
          )}
          <div className='card'>
            <b>Kiểu Udemy (mô phỏng)</b>
            <p data-testid='udemy' className={result?.udemy.startsWith('Lỗi') ? 'err' : 'ok'}>
              {result?.udemy ?? '…'}
            </p>
          </div>
          <div className='card'>
            <b>Bản viết lại</b>
            <p data-testid='ours' className={result?.ours.startsWith('Lỗi') ? 'err' : 'ok'}>
              {result?.ours ?? '…'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

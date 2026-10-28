import { useEffect, useRef, useState } from 'react';
import {
  browserAutoRotates,
  cachedProbe,
  canvasJpeg,
  createResizeHub,
  loadImage,
  measureScrollbar,
  readOrientation,
  supportsMarkOptions,
  supportsPassive,
  toDataUri,
  withOrientation,
  type ScrollbarSize,
} from '../lib/featureProbes';
import { fbResizeRegistry, legacyMarkProbe, once } from '../lib/featureProbesFb';
import { Log, Stat, useLog } from './shared';
import './FeatureProbesDemo.css';

const hex = (bytes: Uint8Array, from: number, to: number) =>
  [...bytes.subarray(from, to)].map((b) => b.toString(16).padStart(2, '0')).join(' ');

export default function FeatureProbesDemo() {
  const [tab, setTab] = useState<'exif' | 'getter' | 'scroll'>('exif');
  return (
    <div className='page probe-demo'>
      <h1>Dò tính năng trình duyệt bằng cách hỏi thẳng</h1>
      <div className='toolbar' role='tablist'>
        {(
          [
            ['exif', '1. Ảnh EXIF 2×1'],
            ['getter', '2. Getter bẫy'],
            ['scroll', '3. Thanh cuộn'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role='tab' aria-selected={tab === k} className={tab === k ? 'primary' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'exif' && <ExifTab />}
      {tab === 'getter' && <GetterTab />}
      {tab === 'scroll' && <ScrollTab />}
    </div>
  );
}

interface ExifState {
  probeHex: string;
  probeLen: number;
  probeOrientation: number | null;
  rotates: boolean;
  naturalW: number;
  naturalH: number;
  sample: string;
  canvasSize: string;
  bitmaps: Array<[string, string]>;
}

function paintArrow(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#1877f2';
  ctx.fillRect(0, 0, 160, 90);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(30, 45);
  ctx.lineTo(60, 20);
  ctx.lineTo(60, 35);
  ctx.lineTo(140, 35);
  ctx.lineTo(140, 55);
  ctx.lineTo(60, 55);
  ctx.lineTo(60, 70);
  ctx.closePath();
  ctx.fill();
  ctx.font = 'bold 14px sans-serif';
  ctx.fillStyle = '#ffd400';
  ctx.fillText('ĐẦU', 4, 16);
}

function ExifTab() {
  const [s, setS] = useState<ExifState | null>(null);
  const [err, setErr] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const raw = await canvasJpeg(2, 1);
      const probe = withOrientation(raw, 6);
      const img = await loadImage(toDataUri(probe));
      const rotates = await browserAutoRotates();
      const sampleBytes = withOrientation(await canvasJpeg(160, 90, paintArrow), 6);
      const sample = toDataUri(sampleBytes);
      const sampleImg = await loadImage(sample);
      const bitmaps: Array<[string, string]> = [];
      const blob = new Blob([sampleBytes as BlobPart], { type: 'image/jpeg' });
      for (const mode of ['from-image', 'none'] as const) {
        try {
          const bm = await createImageBitmap(blob, { imageOrientation: mode as ImageOrientation });
          bitmaps.push([mode, `${bm.width}×${bm.height}`]);
          bm.close();
        } catch (e) {
          bitmaps.push([mode, `lỗi: ${(e as Error).message}`]);
        }
      }
      if (!alive) return;
      let app1 = 2;
      while (app1 < probe.length - 1 && !(probe[app1] === 0xff && probe[app1 + 1] === 0xe1)) app1++;
      setS({
        probeHex: hex(probe, app1, app1 + 36),
        probeLen: probe.length,
        probeOrientation: readOrientation(probe),
        rotates,
        naturalW: img.naturalWidth,
        naturalH: img.naturalHeight,
        sample,
        canvasSize: `${sampleImg.naturalWidth}×${sampleImg.naturalHeight}`,
        bitmaps,
      });
      requestAnimationFrame(() => {
        const c = canvasRef.current;
        if (!c) return;
        c.width = sampleImg.naturalWidth;
        c.height = sampleImg.naturalHeight;
        c.getContext('2d')!.drawImage(sampleImg, 0, 0);
      });
    })().catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (err) return <p className='err'>{err}</p>;
  if (!s) return <p className='hint'>Đang sinh ảnh probe…</p>;
  return (
    <section>
      <p className='hint'>
        Ảnh probe được sinh ngay trên trang: vẽ canvas 2×1 → xuất JPEG → chèn segment APP1 EXIF với Orientation = 6 (xoay 90°). Nạp
        vào <code>Image</code>: nếu trình duyệt tự xoay thì ảnh thành 1×2.
      </p>
      <div className='stats'>
        <Stat label='kết quả dò' value={<span data-testid='rotates'>{s.rotates ? 'tự xoay theo EXIF' : 'không xoay'}</span>} />
        <Stat label='naturalWidth × naturalHeight' value={<span data-testid='natural'>{`${s.naturalW}×${s.naturalH}`}</span>} />
        <Stat label='Orientation đọc lại' value={s.probeOrientation ?? '—'} />
        <Stat label='cỡ file probe' value={`${s.probeLen} byte`} />
      </div>
      <pre className='probe-hex' data-testid='hex'>
        APP1: {s.probeHex}
      </pre>
      <p className='hint'>Cùng một ảnh 160×90 có Orientation = 6, hiển thị theo bốn cách:</p>
      <div className='probe-grid'>
        <figure>
          <img src={s.sample} alt='ảnh EXIF 6, mặc định' data-testid='img-default' />
          <figcaption>&lt;img&gt; mặc định</figcaption>
        </figure>
        <figure>
          <img src={s.sample} alt='ảnh EXIF 6, image-orientation none' style={{ imageOrientation: 'none' }} />
          <figcaption>image-orientation: none</figcaption>
        </figure>
        <figure>
          <canvas ref={canvasRef} />
          <figcaption>drawImage từ &lt;img&gt; ({s.canvasSize})</figcaption>
        </figure>
        <figure className='probe-bitmaps'>
          {s.bitmaps.map(([m, v]) => (
            <div key={m}>
              createImageBitmap <code>{m}</code>: <b data-testid={`bm-${m}`}>{v}</b>
            </div>
          ))}
        </figure>
      </div>
    </section>
  );
}

function GetterTab() {
  const { lines, add } = useLog();
  const [res, setRes] = useState<{ l3: boolean; passive: boolean; fb: { supported: boolean; leftover: number }; after: number } | null>(null);
  const run = () => {
    performance.clearMeasures('__v3');
    const l3 = supportsMarkOptions();
    const passive = supportsPassive();
    const after = performance.getEntriesByType('measure').filter((e) => e.name.startsWith('__probe')).length;
    const fb = legacyMarkProbe();
    setRes({ l3, passive, fb, after });
    add(`bản viết lại: L3 = ${l3}, passive = ${passive}, measure để lại = ${after}`, 'ok');
    add(`cách bản gốc: L3 = ${fb.supported}, measure "__v3" để lại = ${fb.leftover}`, fb.leftover ? 'warn' : 'ok');
  };
  return (
    <section>
      <p className='hint'>
        Muốn biết <code>new PerformanceMark(name, options)</code> có hiểu <code>options.startTime</code> không: truyền một object có
        getter <code>startTime</code>. Trình duyệt hỗ trợ sẽ đọc thuộc tính đó, getter bật cờ. Cùng mẹo với dò{' '}
        <code>{'{ passive }'}</code> của addEventListener.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={run} data-testid='run-getter'>
          Chạy dò
        </button>
      </div>
      {res && (
        <div className='stats'>
          <Stat label='User Timing L3' value={<span data-testid='l3'>{res.l3 ? 'có' : 'không'}</span>} />
          <Stat label='passive listener' value={res.passive ? 'có' : 'không'} />
          <Stat label='measure rác (bản gốc)' value={<span data-testid='leftover'>{res.fb.leftover}</span>} />
          <Stat label='measure rác (viết lại)' value={res.after} />
        </div>
      )}
      <Log lines={lines} />
    </section>
  );
}

function ScrollTab() {
  const { lines, add } = useLog();
  const [sizes, setSizes] = useState<{ normal: ScrollbarSize | null; hidden: ScrollbarSize | null } | null>(null);
  const [early, setEarly] = useState<{ fb: string; ours: string } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(240);
  const [counts, setCounts] = useState({ fbV: 0, fbH: 0, hubV: 0, hubH: 0 });
  const removers = useRef<{ fb?: () => void; hub?: () => void }>({});

  useEffect(() => {
    setSizes({ normal: measureScrollbar(), hidden: measureScrollbar(document, 'probe-hide-sb') });
    const el = boxRef.current!;
    const fb = fbResizeRegistry();
    const hub = createResizeHub();
    const bump = (k: keyof typeof counts) => () => setCounts((c) => ({ ...c, [k]: c[k] + 1 }));
    const fbV = fb.observe(el, 'vertical', bump('fbV'));
    fb.observe(el, 'horizontal', bump('fbH'));
    const hubV = hub.observe(el, 'vertical', bump('hubV'));
    hub.observe(el, 'horizontal', bump('hubH'));
    removers.current = { fb: fbV.remove, hub: hubV };
    return () => {
      fb.disconnect();
      hub.disconnect();
    };
  }, []);

  const simulateEarly = () => {
    // giả lập lần gọi đầu xảy ra trước khi có <body> (script trong <head>)
    let doc = { body: null } as unknown as Document;
    const probe = () => {
      const s = measureScrollbar(doc, 'probe-hide-sb');
      return s === null ? null : s.width === 0;
    };
    const fbCanHide = once(() => probe() ?? false);
    const ours = cachedProbe(probe);
    const first = `${fbCanHide()} / ${ours.get()}`;
    doc = document; // body đã có
    setEarly({ fb: String(fbCanHide()), ours: String(ours.get()) });
    add(`lần 1 (chưa có body): once → ${first.split(' / ')[0]}, cachedProbe → ${first.split(' / ')[1]}`, 'muted');
    add(`lần 2 (đã có body): once → ${fbCanHide()} (nhớ kết quả cũ), cachedProbe → ${ours.get()}`, 'ok');
  };

  return (
    <section>
      <p className='hint'>
        Div 100×100 <code>overflow: scroll</code> đặt ngoài màn hình: <code>offsetWidth − clientWidth</code> là độ dày thanh cuộn. Thêm
        class ẩn thanh cuộn rồi đo lại để biết CSS ẩn có tác dụng không.
      </p>
      <div className='stats'>
        <Stat label='thanh cuộn mặc định' value={<span data-testid='sb-normal'>{sizes?.normal ? `${sizes.normal.width} px` : '—'}</span>} />
        <Stat label='sau khi thêm class ẩn' value={<span data-testid='sb-hidden'>{sizes?.hidden ? `${sizes.hidden.width} px` : '—'}</span>} />
        <Stat label='ẩn được thanh cuộn?' value={sizes?.hidden ? (sizes.hidden.width === 0 ? 'có' : 'không') : '—'} />
      </div>
      <div className='toolbar'>
        <button onClick={simulateEarly} data-testid='early'>
          Gọi dò trước khi có body, rồi gọi lại
        </button>
      </div>
      {early && (
        <div className='stats'>
          <Stat label='once() bản gốc, lần 2' value={<span data-testid='early-fb'>{early.fb}</span>} />
          <Stat label='cachedProbe, lần 2' value={<span data-testid='early-ours'>{early.ours}</span>} />
        </div>
      )}
      <p className='hint'>
        ResizeObserver dùng chung: khung dưới có hai listener (dọc, ngang) ở mỗi bên. Gỡ listener dọc rồi đổi kích thước: bản gốc{' '}
        <code>unobserve</code> cả phần tử nên listener ngang cũng câm.
      </p>
      <div className='toolbar'>
        <label>
          Rộng {width} px
          <input type='range' min={160} max={320} value={width} onChange={(e) => setWidth(+e.target.value)} data-testid='box-width' />
        </label>
        <button
          onClick={() => {
            removers.current.fb?.();
            removers.current.hub?.();
            add('đã gỡ listener dọc ở cả hai bên', 'warn');
          }}
          data-testid='remove-v'
        >
          Gỡ listener dọc
        </button>
      </div>
      <div ref={boxRef} className='probe-box' style={{ width }}>
        khung theo dõi
      </div>
      <div className='stats'>
        <Stat label='bản gốc: dọc / ngang' value={<span data-testid='fb-counts'>{`${counts.fbV} / ${counts.fbH}`}</span>} />
        <Stat label='hub viết lại: dọc / ngang' value={<span data-testid='hub-counts'>{`${counts.hubV} / ${counts.hubH}`}</span>} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

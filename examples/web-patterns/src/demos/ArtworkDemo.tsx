import { useEffect, useMemo, useRef, useState } from 'react';
import {
  buildSizes,
  buildSrcset,
  evaluateSizes,
  pickCandidate,
  type Artwork,
  type Profile,
} from '../lib/artwork';
import { PreconnectTracker } from '../lib/artworkPreconnect';
import { Log, Stat, useLog } from './shared';
import './ArtworkDemo.css';

// Profile lấy đúng số liệu trong src/config/components/artwork.ts của apps.apple.com
const PROFILES: Record<string, Profile> = {
  'large-hero': { widths: [1600, 1240, 920, 920, 490], aspectRatio: 16 / 9, crop: 'sr' },
  card: { widths: [525, 525, 490, 394, 738], aspectRatio: 3 / 4, crop: 'sr' },
  'app-icon-river': { widths: [128, 128, 128, 88, 88], aspectRatio: 1, crop: 'bb' },
};

// picsum nhận kích thước trong đường dẫn giống server ảnh của Apple
const TEMPLATE = 'https://picsum.photos/id/1015/{w}/{h}.{f}';

const PAGE_ARTWORKS = [
  'https://is1-ssl.mzstatic.com/image/thumb/Purple/a.png/{w}x{h}{c}.{f}',
  'https://is2-ssl.mzstatic.com/image/thumb/Purple/b.png/{w}x{h}{c}.{f}',
  'https://is1-ssl.mzstatic.com/image/thumb/Purple/c.png/{w}x{h}{c}.{f}',
  'https://picsum.photos/id/10/{w}/{h}.{f}',
  'https://is3-ssl.mzstatic.com/image/thumb/Video/d.png/{w}x{h}{c}.{f}',
  '', // artwork lỗi: template rỗng, tracker phải bỏ qua chứ không ném lỗi
];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export default function ArtworkDemo() {
  const [profileName, setProfileName] = useState('large-hero');
  const [originalWidth, setOriginalWidth] = useState(4000);
  const [viewport, setViewport] = useState(390);
  const [dpr, setDpr] = useState(2);
  const [webp, setWebp] = useState(true);

  const profile = PROFILES[profileName];
  const artwork: Artwork = {
    template: TEMPLATE,
    width: originalWidth,
    height: Math.round(originalWidth / profile.aspectRatio),
  };
  const srcset = buildSrcset(artwork, profile, { fileType: webp ? 'webp' : 'jpg' });
  const sizes = buildSizes(profile, artwork.width);
  const slot = evaluateSizes(sizes, viewport);
  const picked = pickCandidate(srcset, slot, dpr);
  const candidates = srcset.split(', ');
  const largest = parseInt(candidates[candidates.length - 1].split(' ')[1], 10);
  const ratio = (largest / picked.width) ** 2;

  return (
    <div className='page'>
      <h1>srcset từ template URL + preconnect</h1>
      <p className='hint'>
        Chọn profile và kích thước viewport: bảng dưới là srcset/sizes sinh ra theo cách của
        apps.apple.com, dòng được tô là ảnh trình duyệt sẽ chọn.
      </p>

      <div className='toolbar art-controls'>
        <label>
          Profile{' '}
          <select value={profileName} onChange={(e) => setProfileName(e.target.value)}>
            {Object.keys(PROFILES).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <label>
          Ảnh gốc rộng{' '}
          <select value={originalWidth} onChange={(e) => setOriginalWidth(+e.target.value)}>
            {[4000, 1200, 600].map((w) => (
              <option key={w} value={w}>
                {w}px
              </option>
            ))}
          </select>
        </label>
        <label>
          DPR{' '}
          <select value={dpr} onChange={(e) => setDpr(+e.target.value)}>
            {[1, 2, 3].map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          <input type='checkbox' checked={webp} onChange={(e) => setWebp(e.target.checked)} /> webp
        </label>
      </div>
      <label className='art-range'>
        Viewport: <b>{viewport}px</b>
        <input
          type='range'
          min={320}
          max={1900}
          step={10}
          value={viewport}
          onChange={(e) => setViewport(+e.target.value)}
          aria-label='Độ rộng viewport'
        />
      </label>

      <div className='stats'>
        <Stat label='slot theo sizes' value={`${slot}px`} />
        <Stat label={`cần (× DPR ${dpr})`} value={`${slot * dpr}px`} />
        <Stat label='ảnh được chọn' value={<span className='art-val ok'>{picked.width}w</span>} />
        <Stat label='1 ảnh to cho mọi máy' value={<span className='art-val err'>{largest}w</span>} />
        <Stat label='số pixel thừa nếu dùng 1 ảnh' value={`×${ratio.toFixed(1)}`} />
      </div>

      <p className='art-code'>
        <span className='muted'>sizes=</span>"{sizes}"
      </p>
      <table className='art-table'>
        <thead>
          <tr>
            <th>w</th>
            <th>URL ứng viên</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => {
            const [url, w] = c.split(' ');
            return (
              <tr key={c} className={url === picked.url ? 'picked' : undefined}>
                <td>{w}</td>
                <td>{url}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <RealBrowser srcset={srcset} sizes={sizes} viewport={viewport} webp={webp} />
      <PreconnectPanel />
    </div>
  );
}

/** Nhúng <picture> thật vào iframe rộng đúng `viewport` để xem trình duyệt chọn gì. */
function RealBrowser({ srcset, sizes, viewport, webp }: { srcset: string; sizes: string; viewport: number; webp: boolean }) {
  const [boxRef, boxWidth] = useWidth<HTMLDivElement>();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [chosen, setChosen] = useState<string>('…');
  const [doc, setDoc] = useState('');
  const [frame, setFrame] = useState({ key: 0, width: viewport });

  // debounce: kéo thanh trượt không tạo ra hàng chục lần tải ảnh
  useEffect(() => {
    const id = setTimeout(() => {
      setChosen('…');
      setDoc(
        `<!doctype html><style>body{margin:0;font:13px system-ui;color:#999}img{display:block;max-width:100%;height:auto;background:#8884}</style>` +
          `<picture><source type="${webp ? 'image/webp' : 'image/jpeg'}" sizes="${sizes}" srcset="${srcset}">` +
          `<img alt="" width="1600" height="900" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" decoding="async"></picture>`,
      );
      // tạo iframe mới: trình duyệt chọn lại ứng viên từ đầu (không tái dùng ảnh cũ)
      setFrame((f) => ({ key: f.key + 1, width: viewport }));
    }, 350);
    return () => clearTimeout(id);
  }, [srcset, sizes, webp, viewport]);

  const scale = Math.min(1, boxWidth / frame.width);
  const height = 260;

  return (
    <section className='card art-real'>
      <h3>Trình duyệt thật chọn gì? (DPR máy bạn: {window.devicePixelRatio})</h3>
      <p className='hint'>
        iframe rộng đúng {frame.width}px (thu nhỏ để vừa khung). Ảnh tải từ picsum.photos; offline thì
        ảnh lỗi nhưng <code>currentSrc</code> vẫn cho biết ứng viên được chọn.
      </p>
      <div ref={boxRef} className='art-frame-box' style={{ height: height * scale }}>
        <iframe
          key={frame.key}
          ref={frameRef}
          title='picture thật'
          srcDoc={doc}
          style={{ width: frame.width, height, transform: `scale(${scale})` }}
          onLoad={() => {
            const img = frameRef.current?.contentDocument?.querySelector('img');
            const m = img?.currentSrc.match(/\/(\d+)\/(\d+)\.(\w+)$/);
            setChosen(m ? `${m[1]}×${m[2]} .${m[3]}` : img?.currentSrc ? 'placeholder' : '…');
          }}
        />
      </div>
      <p>
        currentSrc: <b data-testid='current-src'>{chosen}</b>
      </p>
    </section>
  );
}

function PreconnectPanel() {
  const log = useLog();
  const [html, setHtml] = useState('');
  const tracker = useMemo(() => new PreconnectTracker(), []);

  const renderPage = () => {
    for (const template of PAGE_ARTWORKS) {
      const url = template.replace('{w}', '300').replace('{h}', '300').replace('{c}', 'bb').replace('{f}', 'webp');
      const isNew = tracker.trackUrl(url);
      if (!template) log.add('<Artwork> template rỗng: bỏ qua, không làm hỏng trang', 'warn');
      else log.add(`<Artwork> ${new URL(url).host}${isNew ? '  → origin mới' : ''}`, isNew ? 'ok' : 'muted');
    }
    setHtml(tracker.toHtml());
  };

  return (
    <section className='card art-real'>
      <h3>PreconnectTracker: SSR gom origin của mọi ảnh</h3>
      <div className='toolbar'>
        <button className='primary' onClick={renderPage}>
          "Render" 6 artwork
        </button>
      </div>
      <div className='split'>
        <Log lines={log.lines} />
        <pre className='art-code' data-testid='preconnect-html'>
          {html || '<head> chưa có preconnect'}
        </pre>
      </div>
    </section>
  );
}

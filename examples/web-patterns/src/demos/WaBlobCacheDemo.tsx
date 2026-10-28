import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BlobCache, type BlobCacheStats, type UrlFactory } from '../lib/waBlobCache';
import { WhatsAppStyleBlobCache } from './WaBlobCacheWhatsAppStyle';
import { Log, Stat, useLog } from './shared';
import './WaBlobCacheDemo.css';

type Mode = 'rewrite' | 'whatsapp';
type Cache = Pick<BlobCache, 'put' | 'has' | 'url' | 'pin' | 'unpin' | 'stats' | 'dispose' | 'purgeNow'>;

const TILE_COUNT = 40;
const BLOB_SIZE = 200 * 1024;
const MB = 1024 * 1024;

/** Ảnh PNG nhỏ + phần đệm để giả lập một ảnh ~200KB (trình duyệt bỏ qua byte sau chunk IEND). */
function makeImageBlob(index: number, version: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 110;
  const ctx = canvas.getContext('2d')!;
  const hue = (index * 37 + version * 140) % 360;
  ctx.fillStyle = `hsl(${hue} 65% 45%)`;
  ctx.fillRect(0, 0, 160, 110);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.fillText(`#${index + 1}`, 14, 44);
  ctx.font = '15px system-ui, sans-serif';
  ctx.fillText(version ? `bản ${version + 1}` : 'bản 1', 14, 80);
  return new Promise((resolve) =>
    canvas.toBlob((png) => {
      const head = png ?? new Blob();
      resolve(new Blob([head, new Uint8Array(Math.max(0, BLOB_SIZE - head.size))], { type: 'image/png' }));
    }, 'image/png'),
  );
}

const formatMB = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;

export default function WaBlobCacheDemo() {
  const [mode, setMode] = useState<Mode>('rewrite');
  const [limitMB, setLimitMB] = useState(4);
  const [stats, setStats] = useState<BlobCacheStats & { live: number; downloads: number }>({
    count: 0,
    size: 0,
    pinned: 0,
    urls: 0,
    evictions: 0,
    live: 0,
    downloads: 0,
  });
  const { lines, add } = useLog(30);
  const live = useRef(new Set<string>());
  const downloads = useRef(0);
  const versions = useRef(new Map<number, number>());
  const [epoch, setEpoch] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  const cache: Cache = useMemo(() => {
    live.current = new Set();
    downloads.current = 0;
    versions.current = new Map();
    const urls: UrlFactory = {
      create(blob) {
        const url = URL.createObjectURL(blob);
        live.current.add(url);
        return url;
      },
      revoke(url) {
        URL.revokeObjectURL(url);
        live.current.delete(url);
      },
    };
    const limit = limitMB * MB;
    return mode === 'rewrite'
      ? new BlobCache({ sizeLimit: limit, purgeDelay: 300, urls })
      : (new WhatsAppStyleBlobCache(limit, urls, 300) as unknown as Cache);
  }, [mode, limitMB]);

  useEffect(() => {
    const id = setInterval(() => {
      setStats({ ...cache.stats(), live: live.current.size, downloads: downloads.current });
    }, 200);
    return () => {
      clearInterval(id);
      cache.dispose();
    };
  }, [cache]);

  const ensure = useCallback(
    async (index: number) => {
      const key = `img-${index}`;
      if (cache.has(key)) return;
      downloads.current++;
      await new Promise((r) => setTimeout(r, 120));
      if (!cache.has(key)) cache.put(key, await makeImageBlob(index, versions.current.get(index) ?? 0));
    },
    [cache],
  );

  async function replaceFirst() {
    const version = (versions.current.get(0) ?? 0) + 1;
    versions.current.set(0, version);
    cache.put('img-0', await makeImageBlob(0, version));
    add(
      mode === 'rewrite'
        ? `Thay ảnh #1 bằng bản ${version + 1}: URL cũ bị revoke, ô hiện bản mới`
        : `Thay ảnh #1 bằng bản ${version + 1}: url() vẫn trả objectURL của bản cũ, ô không đổi`,
      mode === 'rewrite' ? 'ok' : 'warn',
    );
    setEpoch((e) => e + 1);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  const overLimit = stats.size - limitMB * MB;

  return (
    <div className='page wa-blob'>
      <h1>Cache blob có ghim theo refcount</h1>
      <p className='hint'>
        Mỗi ô là một ảnh ~200KB. Ô đang hiện thì được ghim; cuộn đi thì bỏ ghim, cache đẩy ảnh cũ nhất ra
        cho tới khi về dưới giới hạn và revoke objectURL của nó. Ô bị đẩy ra mà cuộn lại thì phải "tải" lại.
      </p>
      <div className='toolbar'>
        <button className={mode === 'rewrite' ? 'primary' : ''} onClick={() => setMode('rewrite')}>
          Bản viết lại
        </button>
        <button className={mode === 'whatsapp' ? 'primary' : ''} onClick={() => setMode('whatsapp')}>
          Kiểu WhatsApp 2020
        </button>
        <label>
          Giới hạn{' '}
          <select value={limitMB} onChange={(e) => setLimitMB(Number(e.target.value))}>
            {[2, 4, 8].map((n) => (
              <option key={n} value={n}>
                {n} MB
              </option>
            ))}
          </select>
        </label>
        <button onClick={replaceFirst}>Thay ảnh #1 bằng bản mới</button>
      </div>
      <div className='stats'>
        <Stat label='blob trong cache' value={stats.count} />
        <Stat label='dung lượng' value={formatMB(stats.size)} />
        <Stat label='đang ghim' value={stats.pinned} />
        <Stat label='objectURL chưa revoke' value={stats.live} />
        <Stat label='lần đẩy ra' value={stats.evictions} />
        <Stat label='lần tải' value={stats.downloads} />
      </div>
      <p className={overLimit > 0 && stats.pinned * BLOB_SIZE < stats.size ? 'warn' : 'muted'} data-testid='limit-note'>
        {overLimit > 0
          ? `Đang vượt giới hạn ${formatMB(overLimit)}${stats.pinned * BLOB_SIZE < stats.size ? ' dù có ảnh không ghim' : ' (toàn ảnh đang ghim)'}`
          : 'Trong giới hạn'}
      </p>
      <div className='wa-blob-grid' ref={scrollRef} data-testid='grid' key={`${mode}-${limitMB}`}>
        {Array.from({ length: TILE_COUNT }, (_, i) => (
          <Tile key={i} index={i} cache={cache} ensure={ensure} root={scrollRef} epoch={i === 0 ? epoch : 0} />
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

function Tile({
  index,
  cache,
  ensure,
  root,
  epoch,
}: {
  index: number;
  cache: Cache;
  ensure: (i: number) => Promise<void>;
  root: React.RefObject<HTMLDivElement | null>;
  epoch: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState<string>();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: root.current,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const key = `img-${index}`;
    let pinned = false;
    ensure(index).then(() => {
      if (cancelled) return;
      cache.pin(key);
      pinned = true;
      setSrc(cache.url(key));
    });
    return () => {
      cancelled = true;
      if (pinned) cache.unpin(key);
      setSrc(undefined);
    };
  }, [visible, index, cache, ensure, epoch]);

  return (
    <div className='wa-blob-tile' ref={ref} data-index={index}>
      {src ? <img src={src} alt={`ảnh ${index + 1}`} /> : <div className='skeleton' />}
    </div>
  );
}

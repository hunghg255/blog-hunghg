import { useEffect, useRef, useState } from 'react';
import {
  getVersioned,
  hasIndexedDB,
  openKV,
  staleWhileRevalidate,
  type KVStore,
} from '../lib/versionedCache';
import { cacheDelete, cacheGet, cacheSet, cleanupOldCaches } from '../lib/cacheStorageKV';
import { createExpiringStorage } from '../lib/expiringStorage';
import { Log, Stat, sleep, useLog } from './shared';
import './ClientCacheDemo.css';

type Tab = 'idb' | 'cache' | 'ttl';

// ---------- "server" giả lập ----------
const server = { i18nVersion: 1, plan: 'Free', requests: 0, kb: 0 };

async function fetchI18nVersion() {
  await sleep(60);
  server.requests++;
  server.kb += 0.05;
  return `v${server.i18nVersion}`;
}

async function fetchI18n(version: string) {
  await sleep(900); // từ điển to, tải lâu
  const dict: Record<string, string> = {};
  for (let i = 0; i < 4000; i++) dict[`screen.${i}.title`] = `Tiêu đề màn hình ${i} (${version})`;
  server.requests++;
  server.kb += JSON.stringify(dict).length / 1024;
  return dict;
}

async function fetchSettings() {
  await sleep(700);
  server.requests++;
  server.kb += 0.3;
  return { plan: server.plan, fetchedAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }) };
}

// ---------- tab 1: IndexedDB ----------
function IdbPanel({ log }: { log: ReturnType<typeof useLog>['add'] }) {
  const kvRef = useRef<KVStore | null>(null);
  const [ready, setReady] = useState(false);
  const [bypass, setBypass] = useState(false);
  const [boot, setBoot] = useState<{ ms: number; outcome: string; sample: string } | null>(null);
  const [settings, setSettings] = useState<{ plan: string; fetchedAt: string; source: string } | null>(null);
  const [, force] = useState(0);

  useEffect(() => {
    let kv: KVStore | null = null;
    let alive = true;
    if (!hasIndexedDB()) {
      log('Trình duyệt không có IndexedDB: mọi lần khởi động đều đi mạng', 'warn');
      setReady(true);
      return;
    }
    openKV('web-patterns-client-cache')
      .then((db) => {
        kv = db;
        if (!alive) return db.close();
        kvRef.current = db;
        setReady(true);
      })
      .catch((e) => {
        log(`Không mở được IndexedDB (${e.message}), dùng mạng`, 'warn');
        setReady(true);
      });
    return () => {
      alive = false;
      kv?.close();
      kvRef.current = null;
    };
  }, [log]);

  const startApp = async () => {
    const kv = kvRef.current;
    const t0 = performance.now();
    const before = server.requests;
    const [i18n, s] = await Promise.all([
      getVersioned(kv, { key: 'i18n_vi', fetchVersion: fetchI18nVersion, fetchData: fetchI18n }, { bypass }),
      staleWhileRevalidate(
        kv,
        'settings',
        fetchSettings,
        (fresh) => {
          setSettings({ ...fresh, source: 'bản mới từ server (tải ở nền)' });
          log(`settings: bản mới về ở nền, gói = ${fresh.plan}`, 'ok');
          force((n) => n + 1);
        },
        { bypass },
      ),
    ]);
    const ms = Math.round(performance.now() - t0);
    setBoot({ ms, outcome: i18n.outcome, sample: i18n.value['screen.7.title'] });
    setSettings({ ...s.value, source: s.fromCache ? 'cache (có thể cũ)' : 'server' });
    const tone = i18n.outcome === 'hit' ? 'ok' : 'warn';
    log(`Khởi động ${ms}ms · i18n: ${i18n.outcome} (${i18n.version}) · ${server.requests - before} request`, tone);
  };

  const clear = async () => {
    await kvRef.current?.clear();
    setBoot(null);
    setSettings(null);
    log('Đã xoá IndexedDB', 'muted');
  };

  return (
    <>
      <p className='hint'>
        Bấm <b>Mở app</b> vài lần. Lần đầu phải tải từ điển (~900ms); các lần sau chỉ hỏi version (60ms) rồi đọc
        IndexedDB. <b>Server đổi version</b> thì lần mở kế tiếp tự tải lại. Settings dùng stale-while-revalidate: hiện
        bản cũ ngay, bản mới về sau.
      </p>
      <div className='toolbar'>
        <button className='primary' disabled={!ready} onClick={startApp} data-testid='boot'>
          ▶ Mở app
        </button>
        <button
          onClick={() => {
            server.i18nVersion++;
            log(`Server: deploy bản dịch mới v${server.i18nVersion}`);
            force((n) => n + 1);
          }}
        >
          Server đổi version i18n
        </button>
        <button
          onClick={() => {
            server.plan = server.plan === 'Free' ? 'Pro' : 'Free';
            log(`Server: tài khoản đổi sang gói ${server.plan}`);
            force((n) => n + 1);
          }}
        >
          Đổi gói (settings)
        </button>
        <label className='switch'>
          <input type='checkbox' checked={bypass} onChange={(e) => setBypass(e.target.checked)} />
          ?clear-cache
        </label>
        <button onClick={clear}>Xoá IndexedDB</button>
      </div>
      <div className='stats'>
        <Stat label='thời gian khởi động' value={boot ? `${boot.ms}ms` : '–'} />
        <Stat label='i18n' value={<output data-testid='outcome'>{boot?.outcome ?? '–'}</output>} />
        <Stat label='request tới server' value={server.requests} />
        <Stat label='đã tải' value={`${Math.round(server.kb)} KB`} />
      </div>
      <div className='cc-grid'>
        <div className='card'>
          <small className='muted'>i18n (server đang ở v{server.i18nVersion})</small>
          <div>{boot?.sample ?? '–'}</div>
        </div>
        <div className='card'>
          <small className='muted'>settings · {settings?.source ?? '–'}</small>
          <div>
            Gói <b>{settings?.plan ?? '–'}</b> <span className='muted'>lấy lúc {settings?.fetchedAt ?? '–'}</span>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------- tab 2: Cache Storage ----------
const CACHE_PREFIX = 'demo-stickers-';

function makeSticker(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 96;
  const ctx = canvas.getContext('2d')!;
  const hue = Math.floor(Math.random() * 360);
  ctx.fillStyle = `hsl(${hue} 80% 60%)`;
  ctx.beginPath();
  ctx.arc(48, 48, 44, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '48px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', 48, 52);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
}

function CachePanel({ log }: { log: ReturnType<typeof useLog>['add'] }) {
  const [version, setVersion] = useState(1);
  const [img, setImg] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const supported = typeof caches !== 'undefined';
  const cacheName = `${CACHE_PREFIX}v${version}`;

  const refreshNames = async () => {
    if (supported) setNames((await caches.keys()).filter((n) => n.startsWith(CACHE_PREFIX)));
  };

  useEffect(() => {
    void refreshNames();
    return () => {
      if (img) URL.revokeObjectURL(img);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img]);

  if (!supported) return <p className='warn'>Trình duyệt / ngữ cảnh này không có Cache Storage (cần HTTPS hoặc localhost).</p>;

  return (
    <>
      <p className='hint'>
        Key có dấu <code>:</code> như <code>sticker:42</code> không dùng thẳng làm URL được. Lưu Blob ảnh và JSON vào{' '}
        <code>{cacheName}</code>, đọc lại, rồi nâng version tên cache và dọn bản cũ.
      </p>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={async () => {
            const blob = await makeSticker();
            const ok = await cacheSet(cacheName, 'sticker:42', blob);
            await cacheSet(cacheName, 'meta:42', { id: 42, savedAt: Date.now() });
            log(ok ? `Đã lưu sticker:42 (${blob.size} byte, ${blob.type}) vào ${cacheName}` : 'Lưu thất bại', ok ? 'ok' : 'err');
            void refreshNames();
          }}
        >
          Lưu sticker
        </button>
        <button
          onClick={async () => {
            const blob = await cacheGet(cacheName, 'sticker:42', 'blob');
            const meta = await cacheGet<{ savedAt: number }>(cacheName, 'meta:42', 'json');
            if (!blob) return log(`Không có sticker:42 trong ${cacheName}`, 'warn');
            setImg(URL.createObjectURL(blob));
            log(`Đọc lại: ${blob.size} byte, type="${blob.type}", lưu lúc ${new Date(meta!.savedAt).toLocaleTimeString('vi-VN')}`, 'ok');
          }}
        >
          Đọc lại
        </button>
        <button
          onClick={async () => {
            setVersion((v) => v + 1);
            const removed = await cleanupOldCaches(CACHE_PREFIX, `${CACHE_PREFIX}v${version + 1}`);
            log(`Nâng lên v${version + 1}, đã xoá: ${removed.join(', ') || '(không có)'}`, 'warn');
            setImg(null);
            void refreshNames();
          }}
        >
          Đổi format → v{version + 1}
        </button>
        <button
          onClick={async () => {
            await Promise.all(names.map((n) => cacheDelete(n)));
            setImg(null);
            void refreshNames();
          }}
        >
          Xoá hết
        </button>
      </div>
      <div className='cc-grid'>
        <div className='card cc-sticker'>{img ? <img src={img} alt='sticker từ Cache Storage' width={96} height={96} /> : <span className='muted'>chưa đọc</span>}</div>
        <div className='card'>
          <small className='muted'>caches.keys()</small>
          <div data-testid='cache-names'>{names.length ? names.join(', ') : '(trống)'}</div>
        </div>
      </div>
    </>
  );
}

// ---------- tab 3: localStorage có TTL ----------
const NAMESPACE = 'demo:recent-search';
const RAW_KEY = `expiring:${NAMESPACE}`;

function TtlPanel({ log }: { log: ReturnType<typeof useLog>['add'] }) {
  const storeRef = useRef(createExpiringStorage(NAMESPACE, { ttl: 8000, maxItems: 5 }));
  // Cách ngây thơ: đọc localStorage MỘT lần lúc mở trang rồi giữ bản sao trong bộ nhớ
  const naiveSnapshot = useRef<Record<string, unknown> | null>(null);
  if (naiveSnapshot.current === null) {
    try {
      naiveSnapshot.current = JSON.parse(localStorage.getItem(RAW_KEY) || '{}');
    } catch {
      naiveSnapshot.current = {};
    }
  }
  const [text, setText] = useState('react compiler');
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, []);

  const store = storeRef.current;
  const entries = store.entries();
  let raw = '';
  try {
    raw = localStorage.getItem(RAW_KEY) ?? '';
  } catch {
    raw = '(không đọc được localStorage)';
  }

  // "Tab khác" ghi thẳng vào localStorage; cách ngây thơ giữ bản sao trong bộ nhớ nên sẽ đè mất
  const writeFromOtherTab = () => {
    const other = createExpiringStorage(NAMESPACE, { ttl: 8000, maxItems: 5 });
    other.set(`từ tab khác #${Math.floor(Math.random() * 100)}`, true);
    log('Tab khác vừa ghi 1 mục vào cùng namespace', 'muted');
  };

  const naiveWrite = () => {
    const snapshot = naiveSnapshot.current!;
    snapshot[text] = { v: true, exp: Date.now() + 8000 };
    localStorage.setItem(RAW_KEY, JSON.stringify(snapshot));
    log(`Cách ngây thơ ghi "${text}" từ bản sao lúc mở trang: mọi mục ghi sau đó (kể cả của tab khác) bị mất`, 'err');
  };

  return (
    <>
      <p className='hint'>
        Mỗi mục sống 8 giây, tối đa 5 mục. Thử <b>Tab khác ghi</b> rồi <b>Lưu</b>: bản đọc-lại-trước-khi-ghi giữ được
        mục của tab khác; <b>Lưu kiểu ngây thơ</b> ghi từ bản sao chụp lúc mở trang nên đè mất nó.
      </p>
      <div className='toolbar'>
        <input type='text' value={text} onChange={(e) => setText(e.target.value)} style={{ maxWidth: 220 }} aria-label='Từ khoá' />
        <button
          className='primary'
          onClick={() => {
            store.set(text, true);
            log(`Lưu "${text}" (đọc lại localStorage trước khi ghi)`, 'ok');
          }}
        >
          Lưu
        </button>
        <button onClick={writeFromOtherTab}>Tab khác ghi</button>
        <button onClick={naiveWrite}>Lưu kiểu ngây thơ</button>
        <button onClick={() => store.clear()}>Xoá</button>
      </div>
      <div className='cc-grid'>
        <div className='card'>
          <small className='muted'>Mục còn hạn</small>
          <ul className='cc-list' data-testid='ttl-list'>
            {entries.length === 0 && <li className='muted'>(trống)</li>}
            {entries.map((e) => (
              <li key={e.key}>
                {e.key} <span className={e.remaining < 3000 ? 'warn' : 'muted'}>{(e.remaining / 1000).toFixed(1)}s</span>
              </li>
            ))}
          </ul>
        </div>
        <div className='card'>
          <small className='muted'>localStorage["{RAW_KEY}"]</small>
          <pre className='cc-raw'>{raw || '(không có)'}</pre>
        </div>
      </div>
    </>
  );
}

export default function ClientCacheDemo() {
  const [tab, setTab] = useState<Tab>('idb');
  const { lines, add } = useLog();
  return (
    <div className='page'>
      <h1>Cache phía client theo version</h1>
      <div className='toolbar' role='tablist' aria-label='Loại cache'>
        {(
          [
            ['idb', 'IndexedDB + version (Similarweb)'],
            ['cache', 'Cache Storage (Telegram)'],
            ['ttl', 'localStorage có TTL (Udemy)'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role='tab' aria-selected={tab === key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'idb' && <IdbPanel log={add} />}
      {tab === 'cache' && <CachePanel log={add} />}
      {tab === 'ttl' && <TtlPanel log={add} />}
      <Log lines={lines} />
    </div>
  );
}

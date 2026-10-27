import { useEffect, useMemo, useRef, useState } from 'react';
import { createRouteStore, normalizeUrl, type ResolveResult } from '../lib/routeCache';
import { Log, Stat, sleep, useLog } from './shared';
import './RouteCacheDemo.css';

const NETWORK_MS = 450;

function fakeServer(onRequest: (url: string) => void) {
  return async (url: string): Promise<ResolveResult> => {
    onRequest(url);
    await sleep(NETWORK_MS);
    const { pathname } = new URL(url, 'https://example.test');
    if (pathname === '/me') return { type: 'redirect', to: '/profile.php?id=4' };
    if (pathname === '/profile.php') return { type: 'route', name: 'ProfilePage', significant: ['id'] };
    if (pathname.startsWith('/groups/')) return { type: 'route', name: 'GroupPage', significant: [] };
    if (pathname === '/watch') return { type: 'route', name: 'WatchPage', significant: ['v'] };
    return { type: 'route', name: 'NotFound', significant: [] };
  };
}

const LINKS = [
  '/profile.php?id=1&__tn__=R',
  '/profile.php?id=1&ref=feed',
  '/profile.php?id=2&__cft__=abc',
  '/me',
  '/groups/react-vn/?ref=bookmarks',
  '/watch?v=42&t=10',
  '/watch?v=42&t=95',
];

type PushDelay = 200 | 1500 | 'never';
type Mode = 'bounded' | 'fb';

export default function RouteCacheDemo() {
  const { lines, add, clear } = useLog(40);
  const [mode, setMode] = useState<Mode>('bounded');
  const [delay, setDelay] = useState<PushDelay>(1500);
  const [requests, setRequests] = useState(0);
  const [current, setCurrent] = useState<string>('—');
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  const timers = useRef<number[]>([]);

  const store = useMemo(() => {
    return createRouteStore({
      resolve: fakeServer((url) => {
        setRequests((n) => n + 1);
        add(`→ mạng: hỏi server route của ${url}`, 'muted');
      }),
      // bản gốc: điều hướng không chờ route đang được đẩy tới, không có trong cache là gọi mạng ngay
      maxWaitOnNavigate: mode === 'fb' ? 0 : 300,
    });
    // tạo store mới mỗi lần đổi chế độ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    setRequests(0);
    const pendingTimers = timers.current;
    return () => pendingTimers.forEach(clearTimeout);
  }, [store]);

  const loadFeed = () => {
    // response của trang feed kèm danh sách URL có trên trang; route của chúng tới sau
    const urls = ['/profile.php?id=1', '/profile.php?id=2'];
    store.expect(urls);
    add(`Tải feed: server báo sẽ đẩy route cho ${urls.join(', ')} ${delay === 'never' ? '(nhưng không bao giờ tới)' : `sau ${delay}ms`}`);
    if (delay !== 'never') {
      timers.current.push(
        window.setTimeout(() => {
          urls.forEach((u) => store.deliver(u, { type: 'route', name: 'ProfilePage', significant: ['id'] }));
          add('Payload route được đẩy tới', 'ok');
          setTick((t) => t + 1);
        }, delay),
      );
    }
    setTick((t) => t + 1);
  };

  const go = async (url: string) => {
    setBusy(true);
    try {
      const { route, source, waitedMs } = await store.navigate(url);
      setCurrent(`${route.name} (${normalizeUrl(url)})`);
      const tone = source === 'network' ? 'warn' : 'ok';
      add(`${url} → ${route.name}  [${source}${waitedMs >= 1 ? `, chờ ${Math.round(waitedMs)}ms` : ''}]`, tone);
    } finally {
      setBusy(false);
      setTick((t) => t + 1);
    }
  };

  const prefetch = (url: string) => {
    if (store.lookup(url)) return;
    store.prefetch(url).then(({ route, source }) => {
      add(`prefetch ${url} → ${route.name} [${source}]`, 'muted');
      setTick((t) => t + 1);
    });
  };

  const stats = store.stats();

  return (
    <div className='page rc-demo'>
      <h1>Cache route do server phân giải</h1>
      <p className='hint'>
        Bấm cùng một trang với param khác nhau: param tracking và param không có nghĩa không tạo request mới. Bấm "Tải
        feed" rồi bấm ngay hồ sơ #1 (link có <code>__tn__</code>): route đang được server đẩy tới. Bản gốc không chờ nên
        gọi mạng thêm một lần; bản viết lại chờ tối đa 300ms. Rê chuột lên link là prefetch: prefetch thì luôn chờ
        route được đẩy tới.
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        <label className='switch'>
          <input type='radio' checked={mode === 'bounded'} onChange={() => setMode('bounded')} /> Chờ tối đa 300ms
        </label>
        <label className='switch'>
          <input type='radio' checked={mode === 'fb'} onChange={() => setMode('fb')} /> Như bản gốc (điều hướng không chờ)
        </label>
      </div>
      <div className='toolbar' role='group' aria-label='Payload đẩy trước tới sau'>
        <span className='muted'>Payload đẩy trước tới sau:</span>
        {([200, 1500, 'never'] as PushDelay[]).map((d) => (
          <label key={String(d)} className='switch'>
            <input type='radio' checked={delay === d} onChange={() => setDelay(d)} /> {d === 'never' ? 'không bao giờ tới' : `${d}ms`}
          </label>
        ))}
      </div>
      <div className='stats'>
        <Stat label='request phân giải route' value={<output data-testid='requests'>{requests}</output>} />
        <Stat label='URL trong cache' value={<output data-testid='urls'>{stats.urls}</output>} />
        <Stat label='path trong cache' value={<output data-testid='paths'>{stats.paths}</output>} />
        <Stat label='đang chờ đẩy' value={<output data-testid='pending'>{stats.pending}</output>} />
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={loadFeed}>
          Tải feed (server báo trước 2 URL)
        </button>
        <button onClick={() => store.invalidatePath('/profile.php')}>Xoá cache /profile.php</button>
      </div>
      <ul className='rc-links'>
        {LINKS.map((url) => (
          <li key={url}>
            <button onClick={() => go(url)} onMouseEnter={() => prefetch(url)} disabled={busy} data-testid={`go-${url}`}>
              {url}
            </button>
          </li>
        ))}
      </ul>
      <p data-testid='current'>
        Trang hiện tại: <b>{current}</b> {busy && <span className='spinner' aria-label='Đang tải' />}
      </p>
      <div className='toolbar'>
        <button onClick={clear}>Xoá log</button>
      </div>
      <Log lines={lines} />
    </div>
  );
}

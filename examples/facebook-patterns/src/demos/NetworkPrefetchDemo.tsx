import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TAIL_LOAD_BUFFER,
  createRttEstimator,
  createTailLoader,
  guessConnectionClass,
  tailBufferFor,
  type ConnectionClass,
} from '../lib/networkAwarePrefetch';
import {
  classifyDevice,
  createHiddenTimeline,
  measureResourceSpeed,
  readGpu,
  readHardware,
  type DeviceInfo,
} from '../lib/deviceClass';
import { Log, Stat, sleep, useLog } from './shared';
import './NetworkPrefetchDemo.css';

type Profile = Exclude<ConnectionClass, 'UNKNOWN'>;
type BufferMode = 'fb' | 'excellent' | 'fixed' | 'zero';

/** độ trễ trung bình của "server giả" cho mỗi loại mạng */
const LATENCY: Record<Profile, number> = { EXCELLENT: 180, GOOD: 550, MODERATE: 1200, POOR: 2600 };
const POST_HEIGHT = 240;
const PAGE_SIZE = 6;
const MAX_PAGES = 40;
// Kịch bản "người thật": vuốt nhanh một đoạn rồi dừng đọc, lặp lại vài lần
const FLING_PX = 1500;
const FLING_MS = 400;
const READ_MS = 1600;
const CYCLES = 5;

interface Post {
  id: number;
  hue: number;
}

function makePage(page: number): Post[] {
  return Array.from({ length: PAGE_SIZE }, (_, i) => {
    const id = page * PAGE_SIZE + i;
    return { id, hue: (id * 47) % 360 };
  });
}

export default function NetworkPrefetchDemo() {
  const { lines, add, clear } = useLog(30);
  const [profile, setProfile] = useState<Profile>('MODERATE');
  const [mode, setMode] = useState<BufferMode>('fb');
  const [posts, setPosts] = useState<Post[]>(() => makePage(0));
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ requests: 0, collisions: 0, waitMs: 0 });
  const [guessed, setGuessed] = useState<ConnectionClass>('UNKNOWN');
  const [running, setRunning] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const pageRef = useRef(1);
  const collisionAtRef = useRef<number | null>(null);
  const rtt = useMemo(() => createRttEstimator(), []);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const bufferPx =
    mode === 'zero' ? 0 : mode === 'fixed' ? 600 : mode === 'excellent' ? TAIL_LOAD_BUFFER.EXCELLENT : tailBufferFor(guessed);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || pageRef.current >= MAX_PAGES) return;
    loadingRef.current = true;
    setLoading(true);
    const page = pageRef.current;
    const started = performance.now();
    const latency = LATENCY[profileRef.current] * (0.8 + Math.random() * 0.4);
    setStats((s) => ({ ...s, requests: s.requests + 1 }));
    await sleep(latency);
    const took = performance.now() - started;
    const estimate = rtt.add(took);
    const nextClass = guessConnectionClass({ measuredRttMs: estimate });
    setGuessed(nextClass);
    pageRef.current = page + 1;
    setPosts((prev) => [...prev, ...makePage(page)]);
    loadingRef.current = false;
    setLoading(false);
    if (collisionAtRef.current != null) {
      const waited = performance.now() - collisionAtRef.current;
      collisionAtRef.current = null;
      setStats((s) => ({ ...s, waitMs: s.waitMs + waited }));
      add(`trang ${page + 1} về sau ${Math.round(took)}ms; người dùng đã phải nhìn skeleton ${Math.round(waited)}ms`, 'err');
    } else {
      add(`trang ${page + 1} về sau ${Math.round(took)}ms, kịp trước khi cuộn tới`, 'ok');
    }
  }, [add, rtt]);

  // Tạo lại observer khi đổi buffer
  const loaderRef = useRef<ReturnType<typeof createTailLoader> | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;
    const loader = createTailLoader({
      root,
      sentinel,
      bufferPx,
      onLoadMore: () => void loadMore(),
      onCollision: () => {
        if (pageRef.current >= MAX_PAGES) return;
        collisionAtRef.current = performance.now();
        setStats((s) => ({ ...s, collisions: s.collisions + 1 }));
      },
    });
    loaderRef.current = loader;
    return () => loader.destroy();
  }, [bufferPx, loadMore]);

  // tải xong mà đuôi feed vẫn trong vùng buffer: IntersectionObserver không tự báo lại
  useEffect(() => {
    loaderRef.current?.recheck();
  }, [posts.length]);

  const reset = () => {
    pageRef.current = 1;
    loadingRef.current = false;
    collisionAtRef.current = null;
    rtt.reset();
    setGuessed('UNKNOWN');
    setLoading(false);
    setPosts(makePage(0));
    setStats({ requests: 0, collisions: 0, waitMs: 0 });
    clear();
    rootRef.current?.scrollTo({ top: 0 });
  };

  const autoScroll = async () => {
    const root = rootRef.current;
    if (!root || running) return;
    setRunning(true);
    add(`${CYCLES} lần: vuốt ${FLING_PX}px trong ${FLING_MS}ms rồi đọc ${READ_MS}ms; buffer ${bufferPx}px`, 'muted');
    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const start = performance.now();
      let last = start;
      await new Promise<void>((resolve) => {
        const step = (now: number) => {
          root.scrollTop += (FLING_PX * (now - last)) / FLING_MS;
          last = now;
          if (now - start < FLING_MS) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      await sleep(READ_MS);
    }
    setRunning(false);
  };

  return (
    <div className='page np-demo'>
      <h1>Tải trước theo chất lượng mạng</h1>
      <p className='hint'>
        Chọn loại mạng rồi bấm "Tự cuộn" (5 lần vuốt nhanh, mỗi lần dừng đọc 1,6 giây). Ở chế độ
        của Facebook, buffer lấy theo hạng mạng đoán từ thời gian các request vừa rồi: mạng càng
        chậm thì bắt đầu tải càng sớm (2570 → 4948px). So với buffer cố định 600px: người dùng va
        vào skeleton nhiều lần hơn và phải chờ lâu hơn.
      </p>

      <div className='toolbar'>
        <label>
          Mạng giả lập{' '}
          <select value={profile} onChange={(e) => setProfile(e.target.value as Profile)}>
            {(Object.keys(LATENCY) as Profile[]).map((p) => (
              <option key={p} value={p}>
                {p} (~{LATENCY[p]}ms)
              </option>
            ))}
          </select>
        </label>
        <label>
          Buffer{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as BufferMode)}>
            <option value='fb'>theo hạng mạng (Facebook)</option>
            <option value='excellent'>luôn 2570px (bỏ qua hạng mạng)</option>
            <option value='fixed'>cố định 600px</option>
            <option value='zero'>0px (chỉ tải khi thấy đuôi)</option>
          </select>
        </label>
        <button className='primary' onClick={autoScroll} disabled={running}>
          {running ? 'Đang cuộn…' : 'Tự cuộn'}
        </button>
        <button onClick={reset} disabled={running}>
          Làm lại
        </button>
      </div>

      <div className='stats'>
        <Stat label='hạng mạng đoán được' value={guessed} />
        <Stat label='buffer đang dùng' value={`${bufferPx}px`} />
        <Stat label='request' value={stats.requests} />
        <Stat label='va vào skeleton' value={<output data-testid='np-collisions'>{stats.collisions}</output>} />
        <Stat label='tổng thời gian chờ' value={`${Math.round(stats.waitMs)}ms`} />
      </div>

      <div className='split np-split'>
        <div ref={rootRef} className='np-feed' data-testid='np-feed'>
          {posts.map((p) => (
            <article key={p.id} className='np-post' style={{ height: POST_HEIGHT - 12 }}>
              <div className='np-media' style={{ background: `hsl(${p.hue} 60% 55% / 0.35)` }} />
              <b>Bài viết #{p.id + 1}</b>
            </article>
          ))}
          <div ref={sentinelRef} className='np-tail'>
            {pageRef.current >= MAX_PAGES ? (
              <span className='muted'>Hết bài</span>
            ) : (
              <>
                <div className='skeleton' style={{ height: 18, width: '60%' }} />
                <div className='skeleton' style={{ height: 120, marginTop: 8 }} />
                {loading && <span className='spinner' aria-label='đang tải' />}
              </>
            )}
          </div>
        </div>
        <div>
          <table className='np-table'>
            <thead>
              <tr>
                <th>Hạng mạng</th>
                <th>Buffer của FB</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(TAIL_LOAD_BUFFER) as Profile[]).map((c) => (
                <tr key={c} className={c === guessed && mode === 'fb' ? 'np-active' : undefined}>
                  <td>{c}</td>
                  <td>{TAIL_LOAD_BUFFER[c]}px</td>
                </tr>
              ))}
            </tbody>
          </table>
          <DevicePanel />
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}

function DevicePanel() {
  const [info, setInfo] = useState<DeviceInfo | null>(null);
  useEffect(() => {
    const timeline = createHiddenTimeline();
    const measure = () => {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      setInfo({ ...readHardware(), ...readGpu(), ...measureResourceSpeed(entries, timeline.hiddenTime) });
    };
    const id = setTimeout(measure, 300);
    return () => {
      clearTimeout(id);
      timeline.destroy();
    };
  }, []);
  if (!info) return <p className='muted'>Đang đo thiết bị…</p>;
  const fmt = (v: number | undefined, unit: string) => (v == null ? '(không có)' : `${Math.round(v)} ${unit}`);
  return (
    <div className='card np-device'>
      <b>
        Thiết bị này: <span className='badge'>{classifyDevice(info)}</span>
      </b>
      <ul>
        <li>CPU: {info.cpuCores ?? '(không có)'} nhân</li>
        <li>RAM: {info.ramGb != null ? `${info.ramGb} GB` : '(trình duyệt không cho biết)'}</li>
        <li className='np-gpu'>GPU: {info.gpuRenderer ?? '(không đọc được)'}</li>
        <li>
          Đọc cache: {fmt(info.cachedSpeed, 'B/ms')} ({info.cachedFiles} file)
        </li>
        <li>
          Tải mạng: {fmt(info.networkSpeed, 'B/ms')} ({info.networkFiles} file)
        </li>
      </ul>
    </div>
  );
}

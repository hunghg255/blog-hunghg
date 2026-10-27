import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useHiddenSubtreePassive, useVisibleInterval } from '../lib/hiddenSubtree';
import { KeepAliveOutlet, type KeepAliveRouteConfig, type MaintainedEntry } from '../lib/keepAlive';
import { Log, useLog } from './shared';
import './KeepAliveDemo.css';

type TabKey = 'home' | 'feed' | 'messages' | 'settings';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'home', label: 'Home' },
  { key: 'feed', label: 'Feed' },
  { key: 'messages', label: 'Messages' },
  { key: 'settings', label: 'Settings' },
];

// Giống MaintainedRouteConfig: mỗi tab một chính sách riêng (TTL rút ngắn để dễ thử).
const KEEP_ALIVE_CONFIG: Record<TabKey, KeepAliveRouteConfig> = {
  home: { maintained: true, maintainForMs: 15_000 },
  feed: { maintained: true, maintainForMs: 30_000 },
  messages: { maintained: true, maintainForMs: null }, // giữ mãi
  settings: { maintained: false },
};
const NO_KEEP_ALIVE: Record<TabKey, KeepAliveRouteConfig> = {
  home: { maintained: false },
  feed: { maintained: false },
  messages: { maintained: false },
  settings: { maintained: false },
};

// Thời điểm component được tạo: đổi giá trị = tab vừa bị mount lại từ đầu, mất hết state.
function useMountedAt() {
  const [at] = useState(() => new Date().toLocaleTimeString('vi-VN', { hour12: false }));
  return at;
}

function HomeTab() {
  const mountedAt = useMountedAt();
  const [likes, setLikes] = useState(0);
  const [draft, setDraft] = useState('');
  return (
    <div className='ka-panel'>
      <p className='muted'>Mount lúc {mountedAt}. Bấm like, gõ chữ, rồi sang tab khác và quay lại.</p>
      <div className='toolbar'>
        <button className='primary' onClick={() => setLikes((n) => n + 1)}>
          👍 Like ({likes})
        </button>
      </div>
      <input type='text' aria-label='Bạn đang nghĩ gì?' placeholder='Bạn đang nghĩ gì?' value={draft} onChange={(e) => setDraft(e.target.value)} />
    </div>
  );
}

function FeedTab() {
  const mountedAt = useMountedAt();
  return (
    <div className='ka-panel'>
      <p className='muted'>Mount lúc {mountedAt}. Cuộn xuống giữa danh sách rồi đổi tab.</p>
      <div className='ka-scroll' data-testid='feed-scroll'>
        {Array.from({ length: 80 }, (_, i) => (
          <div key={i} className='card ka-story'>
            Bài viết #{i + 1}
          </div>
        ))}
      </div>
    </div>
  );
}

function MessagesTab({ onLog }: { onLog: (text: string) => void }) {
  const mountedAt = useMountedAt();
  const [seconds, setSeconds] = useState(0);
  // Tự dừng khi tab bị ẩn: không tốn CPU cho tab không ai nhìn.
  useVisibleInterval(() => setSeconds((s) => s + 1), 1000);

  // Animation canvas: subscribe store passive để dừng/chạy rAF, KHÔNG re-render khi ẩn/hiện.
  const store = useHiddenSubtreePassive();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let frame = 0;
    let raf = 0;
    const draw = () => {
      frame++;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const x = (Math.sin(frame / 30) * 0.4 + 0.5) * canvas.width;
      ctx.fillStyle = '#ff7a3d';
      ctx.beginPath();
      ctx.arc(x, canvas.height / 2, 14, 0, Math.PI * 2);
      ctx.fill();
      raf = requestAnimationFrame(draw);
    };
    const sync = (state: { hidden: boolean; backgrounded: boolean }) => {
      cancelAnimationFrame(raf);
      if (state.hidden || state.backgrounded) {
        onLog('⏸ Messages bị ẩn: dừng timer + animation');
      } else {
        raf = requestAnimationFrame(draw);
        onLog('▶️ Messages hiện lại: chạy tiếp');
      }
    };
    sync(store.getCurrentState());
    const unsubscribe = store.subscribe(sync);
    return () => {
      unsubscribe();
      cancelAnimationFrame(raf);
    };
  }, [store, onLog]);

  return (
    <div className='ka-panel'>
      <p className='muted'>Mount lúc {mountedAt}.</p>
      <div className='stats'>
        <div className='stat'>
          <b data-testid='active-seconds'>{seconds}s</b>
          <span>thời gian tab đang hiện</span>
        </div>
      </div>
      <canvas ref={canvasRef} width={280} height={48} className='ka-canvas' aria-label='animation' />
    </div>
  );
}

function SettingsTab() {
  const mountedAt = useMountedAt();
  const [dark, setDark] = useState(false);
  return (
    <div className='ka-panel'>
      <p className='muted'>Mount lúc {mountedAt}. Tab này KHÔNG được keep-alive.</p>
      <label className='switch'>
        <input type='checkbox' checked={dark} onChange={(e) => setDark(e.target.checked)} /> Một công tắc bất kỳ
      </label>
    </div>
  );
}

function describe(entry: MaintainedEntry | undefined, now: number) {
  if (!entry) return null;
  if (entry.expiresAt == null) return 'giữ mãi';
  return `huỷ sau ${Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))}s`;
}

export default function KeepAliveDemo() {
  const [active, setActive] = useState<TabKey>('home');
  const [enabled, setEnabled] = useState(true);
  const [maintained, setMaintained] = useState<MaintainedEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const { lines, add } = useLog();
  const log = useCallback((text: string) => add(text), [add]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const config = enabled ? KEEP_ALIVE_CONFIG : NO_KEEP_ALIVE;
  const render = useCallback(
    (key: string) => {
      switch (key as TabKey) {
        case 'home':
          return <HomeTab />;
        case 'feed':
          return <FeedTab />;
        case 'messages':
          return <MessagesTab onLog={log} />;
        default:
          return <SettingsTab />;
      }
    },
    [log],
  );
  const byKey = useMemo(() => new Map(maintained.map((entry) => [entry.key, entry])), [maintained]);

  return (
    <div className='page'>
      <h1>Keep-alive tab</h1>
      <p className='hint'>
        Home giữ 15 giây, Feed 30 giây, Messages giữ mãi, Settings không giữ. Tắt keep-alive để thấy
        mỗi lần đổi tab là mount lại từ đầu.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
          Bật keep-alive
        </label>
      </div>
      <div className='ka-tabs' role='tablist'>
        {TABS.map((tab) => {
          const status = tab.key === active ? 'đang mở' : describe(byKey.get(tab.key), now) ?? 'đã unmount';
          return (
            <button
              key={tab.key}
              role='tab'
              aria-selected={tab.key === active}
              className={tab.key === active ? 'ka-tab active' : 'ka-tab'}
              onClick={() => setActive(tab.key)}
            >
              {tab.label}
              <small data-testid={`status-${tab.key}`}>{status}</small>
            </button>
          );
        })}
      </div>
      <div className='split'>
        <div className='ka-outlet'>
          <KeepAliveOutlet activeKey={active} config={config} render={render} onMaintainedChange={setMaintained} />
        </div>
        <aside>
          <Log lines={lines} />
        </aside>
      </div>
    </div>
  );
}

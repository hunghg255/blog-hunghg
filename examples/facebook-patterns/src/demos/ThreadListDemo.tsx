import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RangedIndex,
  createPresenceStore,
  memoryAdapter,
  type PresenceRecord,
} from '../lib/threadList';
import { Log, Stat, useLog } from './shared';
import './ThreadListDemo.css';

const TOTAL = 240;
const PAGE = 8;

type Thread = { id: string; name: string; ts: number };

/** "Server" giả: 240 thread, trả theo offset, chậm 500ms. */
function createFakeServer() {
  const base = Date.now();
  const threads: Thread[] = Array.from({ length: TOTAL }, (_, i) => ({
    id: `t${i + 1}`,
    name: `Nhóm chat ${i + 1}`,
    ts: base - i * 60_000,
  }));
  const byId = new Map(threads.map((t) => [t.id, t]));
  const ordered = () => [...threads].sort((a, b) => b.ts - a.ts);
  return {
    byId,
    fetch(offset: number, count: number) {
      return new Promise<Thread[]>((resolve) =>
        setTimeout(() => resolve(ordered().slice(offset, offset + count)), 500),
      );
    },
    bump(id: string) {
      const t = byId.get(id);
      if (t) t.ts = Date.now();
    },
  };
}

export default function ThreadListDemo() {
  const log = useLog(30);
  const server = useMemo(createFakeServer, []);
  const meta = useRef(new Map<string, Thread>());
  const index = useMemo(() => new RangedIndex<string>((id) => meta.current.get(id)?.ts), []);
  const [start, setStart] = useState(0);
  const [rows, setRows] = useState<string[] | null>(null);
  const [naive, setNaive] = useState(false);
  const [fetches, setFetches] = useState(0);
  const [tick, setTick] = useState(0);
  const inFlight = useRef(false);

  // nạp thêm `count` thread nối tiếp phần đã có (không bao giờ để lỗ ở giữa)
  async function fetchMore(count: number) {
    if (inFlight.current || count <= 0) return;
    inFlight.current = true;
    setFetches((n) => n + 1);
    const from = index.size;
    log.add(`fetch offset=${from} count=${count}`, 'muted');
    const got = await server.fetch(from, count);
    got.forEach((t) => meta.current.set(t.id, { ...t }));
    inFlight.current = false;
    if (got.length < count) index.setEnded();
    index.add(got.map((t) => t.id));
    setTick((n) => n + 1);
    // trong lúc chờ, người dùng có thể đã xin một khoảng xa hơn: nạp tiếp
    const more = index.wantedSize - index.size;
    if (more > 0 && !index.hasEnded) void fetchMore(more);
  }

  useEffect(() => {
    if (naive) return;
    setRows(null); // skeleton tới khi đủ
    const { id, missing } = index.request(start, PAGE, ({ items }) => {
      setRows(items);
      log.add(`range [${start}, ${start + PAGE}) sẵn sàng`, 'ok');
    });
    if (missing > 0) void fetchMore(missing);
    return () => index.unsubscribe(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, naive]);

  // cách ngây thơ: vẽ ngay phần đang có (kể cả lỗ), dữ liệu về tới đâu vẽ tới đó
  useEffect(() => {
    if (!naive) return;
    setRows(index.getAll().slice(start, start + PAGE));
    const missing = start + PAGE - index.size;
    if (missing > 0 && !index.hasEnded) void fetchMore(missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, naive, start]);

  function newMessage() {
    const loaded = index.getAll();
    if (loaded.length === 0) return;
    const id = loaded[Math.floor(Math.random() * loaded.length)];
    server.bump(id);
    const t = meta.current.get(id)!;
    t.ts = Date.now();
    index.resort();
    log.add(`tin mới trong ${t.name} → lên đầu danh sách`, 'warn');
    setRows(index.getAll().slice(start, start + PAGE));
  }

  const display: (string | null)[] = rows ?? Array.from({ length: PAGE }, () => null);
  while (display.length < PAGE) display.push(null);

  return (
    <div className='page thread-list-demo'>
      <h1>Thread list theo mốc thời gian</h1>
      <p className='hint'>
        240 thread, server trả theo offset sau 500ms. Nhảy thẳng tới vị trí 120: cách của Messenger
        hiện khung chờ rồi vẽ cả trang một lần khi đủ; cách ngây thơ vẽ phần đang có và để lỗ.
      </p>
      <div className='toolbar'>
        <button onClick={() => setStart((s) => Math.max(0, s - PAGE))} disabled={start === 0}>
          ← Trang trước
        </button>
        <button onClick={() => setStart((s) => Math.min(TOTAL - PAGE, s + PAGE))}>
          Trang sau →
        </button>
        <button className='primary' onClick={() => setStart(120)}>
          Nhảy tới vị trí 120
        </button>
        <button onClick={newMessage}>Tin mới ở một thread</button>
        <label className='tl-toggle'>
          <input type='checkbox' checked={naive} onChange={(e) => setNaive(e.target.checked)} />{' '}
          Cách ngây thơ
        </label>
      </div>
      <div className='stats'>
        <Stat label='vị trí đang xem' value={start} />
        <Stat label='thread đã nạp' value={index.size} />
        <Stat label='lần fetch' value={fetches} />
        <Stat label='callback đang chờ' value={index.pendingCount} />
      </div>
      <ol className='tl-list' start={start + 1} data-testid='thread-rows'>
        {display.map((id, i) => {
          const t = id ? meta.current.get(id) : null;
          return (
            <li key={id ?? `empty-${i}`} className={t ? '' : 'tl-empty'}>
              {t ? (
                <>
                  <span className='tl-name'>{t.name}</span>
                  <span className='tl-time'>
                    {new Date(t.ts).toLocaleTimeString('vi-VN', { hour12: false })}
                  </span>
                </>
              ) : (
                <span className={rows ? 'tl-hole' : 'skeleton tl-skeleton'}>
                  {rows ? '(chưa có dữ liệu)' : ''}
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <PresencePanel />
      <Log lines={log.lines} />
    </div>
  );
}

/** Hai "tab" dùng chung một storage: tab A chạy bản cũ (v3), tab B đã lên bản mới (v4). */
function PresencePanel() {
  const storage = useMemo(memoryAdapter, []);
  const [out, setOut] = useState<Record<string, string>>({});
  const tabs = useMemo(
    () => ({
      A: createPresenceStore({
        version: 3,
        currentUser: 'u1',
        primary: storage,
        fallback: memoryAdapter(),
      }),
      B: createPresenceStore({
        version: 4,
        currentUser: 'u1',
        primary: storage,
        fallback: memoryAdapter(),
      }),
    }),
    [storage],
  );
  const show = (tab: 'A' | 'B', text: string) => setOut((o) => ({ ...o, [tab]: text }));
  const fmt = (r: PresenceRecord | null) =>
    r ? `v${r.v}, active=${String(r.active)}` : 'null (bỏ qua)';

  return (
    <div className='card tl-presence'>
      <h2>Presence có version</h2>
      <div className='split'>
        {(['A', 'B'] as const).map((tab) => (
          <div key={tab}>
            <b>
              Tab {tab} (schema v{tab === 'A' ? 3 : 4})
            </b>
            <div className='toolbar'>
              <button
                onClick={() => {
                  const ok = tabs[tab].write({ active: tab === 'A' ? 'web' : 'web+mobile' });
                  show(tab, ok ? 'đã ghi' : 'KHÔNG ghi: storage đang chứa version mới hơn');
                }}
              >
                Ghi
              </button>
              <button onClick={() => show(tab, `đọc được: ${fmt(tabs[tab].read())}`)}>Đọc</button>
            </div>
            <div className='muted' data-testid={`presence-${tab}`}>
              {out[tab] ?? '—'}
            </div>
          </div>
        ))}
      </div>
      <code className='tl-raw'>{JSON.stringify(storage.dump())}</code>
    </div>
  );
}

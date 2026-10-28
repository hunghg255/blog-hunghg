import { useEffect, useRef, useState } from 'react';
import { PausableRangeStream, groupContiguous, rangeHeader, type ByteRange, type RangeEvent } from '../lib/rangeStream';
import { fakeRangeServer, fnv1a, makeFakeFile, type FakeServer } from '../lib/rangeStreamFake';
import { Log, Stat, useLog } from './shared';
import './PausableRangeDemo.css';

const FILE = makeFakeFile(1024 * 1024);
const RANGE: ByteRange = { start: 0, end: FILE.length - 1 };
const EXPECTED = fnv1a(FILE);
const kb = (n: number) => `${Math.round(n / 1024)} KB`;

interface LaneStats {
  sent: number;
  delivered: number;
  requests: number;
  state: 'idle' | 'running' | 'paused' | 'done';
  ok: boolean | null;
}
const EMPTY: LaneStats = { sent: 0, delivered: 0, requests: 0, state: 'idle', ok: null };

interface Lane {
  start(): void;
  pause(): void;
  dispose(): void;
}

interface Flags {
  ignoreRange: boolean;
  drop: boolean;
}

function makeServer(flags: React.RefObject<Flags>): FakeServer {
  return fakeRangeServer(FILE, {
    chunkSize: 16 * 1024,
    tickMs: 25,
    latencyMs: 80,
    honorRange: () => !flags.current.ignoreRange,
    dropAtByte: () => (flags.current.drop ? Math.round(FILE.length * 0.6) : null),
  });
}

/** Cách ngây thơ: mỗi lần tiếp tục là một request mới từ đầu range, bỏ hết phần đã nhận. */
function naiveLane(flags: React.RefObject<Flags>, update: (s: LaneStats) => void, log: (t: string, tone?: 'ok' | 'warn' | 'err') => void): Lane {
  const server = makeServer(flags);
  let ctrl: AbortController | null = null;
  let disposed = false;
  let stats = { ...EMPTY };
  const set = (p: Partial<LaneStats>) => update((stats = { ...stats, ...p, sent: server.sent(), requests: server.requests() }));
  const run = async () => {
    ctrl?.abort();
    const c = (ctrl = new AbortController());
    set({ state: 'running', delivered: 0 });
    log(`[ngây thơ] GET Range: ${rangeHeader(RANGE)}`);
    let hash = 2166136261;
    let got = 0;
    try {
      const res = await server.fetch(RANGE, c.signal);
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash = fnv1a(value, hash);
        got += value.length;
        set({ delivered: got });
      }
      if (got < FILE.length) {
        log(`[ngây thơ] kết nối đóng sớm ở ${kb(got)}, tải lại từ đầu`, 'warn');
        if (!disposed) setTimeout(run, 300);
        return;
      }
      set({ state: 'done', ok: hash >>> 0 === EXPECTED });
      log(`[ngây thơ] xong, mạng đã tải ${kb(server.sent())}`, 'ok');
    } catch {
      if (!disposed) set({ state: 'paused' });
    }
  };
  return {
    start: () => stats.state !== 'running' && stats.state !== 'done' && void run(),
    pause: () => {
      if (stats.state !== 'running') return;
      ctrl?.abort();
      log(`[ngây thơ] tạm dừng, bỏ ${kb(stats.delivered)} đã nhận`, 'warn');
      set({ state: 'paused' });
    },
    dispose: () => {
      disposed = true;
      ctrl?.abort();
    },
  };
}

/** PausableRangeStream: tiếp tục từ byte còn thiếu. Lỗi mạng thì tự thử lại sau 300 ms. */
function pausableLane(flags: React.RefObject<Flags>, update: (s: LaneStats) => void, log: (t: string, tone?: 'ok' | 'warn' | 'err') => void): Lane {
  const server = makeServer(flags);
  let disposed = false;
  let stats = { ...EMPTY };
  const set = (p: Partial<LaneStats>) => update((stats = { ...stats, ...p, sent: server.sent(), requests: server.requests() }));
  const onEvent = (e: RangeEvent) => {
    if (e.type === 'request') log(`[pausable] GET Range: ${rangeHeader(e.range)}`);
    if (e.type === 'response' && e.skip) log(`[pausable] server trả ${e.status}, bỏ ${kb(e.skip)} đầu body`, 'warn');
    if (e.type === 'paused') log(`[pausable] tạm dừng, giữ ${kb(e.received)}`);
    if (e.type === 'network-error') log(`[pausable] ${e.message}`, 'warn');
  };
  const stream = new PausableRangeStream(RANGE, server.fetch, onEvent);
  // Phía đọc: một reader duy nhất suốt vòng đời, không biết gì về pause/resume.
  void (async () => {
    const reader = stream.readable.getReader();
    let hash = 2166136261;
    let got = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || disposed) break;
        hash = fnv1a(value, hash);
        got += value.length;
        set({ delivered: got });
      }
    } catch {
      return; // abort() khi dispose: phía đọc nhận lỗi
    }
    if (disposed) return;
    set({ state: 'done', ok: hash >>> 0 === EXPECTED });
    log(`[pausable] xong, mạng đã tải ${kb(server.sent())}`, 'ok');
  })();
  const run = async () => {
    set({ state: 'running' });
    const r = await stream.start();
    if (disposed) return;
    if (r === 'error') setTimeout(() => !disposed && stats.state === 'running' && void run(), 300);
    else if (r === 'paused') set({ state: 'paused' });
  };
  return {
    start: () => stats.state !== 'running' && stats.state !== 'done' && void run(),
    pause: () => {
      if (stats.state !== 'running') return;
      stream.pause();
      set({ state: 'paused' });
    },
    dispose: () => {
      disposed = true;
      stream.abort();
    },
  };
}

function LaneView({ title, s, note }: { title: string; s: LaneStats; note: string }) {
  const wasted = Math.max(0, s.sent - FILE.length);
  return (
    <div className={`card prd-lane${s.state === 'done' ? ' active' : ''}`}>
      <div className='prd-head'>
        <b>{title}</b>
        <span className={`badge prd-${s.state}`}>{{ idle: 'chưa chạy', running: 'đang tải', paused: 'tạm dừng', done: 'xong' }[s.state]}</span>
      </div>
      <p className='muted prd-note'>{note}</p>
      <div className='prd-bar' role='progressbar' aria-valuenow={Math.round((s.delivered / FILE.length) * 100)} aria-valuemin={0} aria-valuemax={100}>
        <i style={{ width: `${(s.delivered / FILE.length) * 100}%` }} />
      </div>
      <div className='stats prd-stats'>
        <Stat label='Phía đọc đã nhận' value={kb(s.delivered)} />
        <Stat label='Mạng đã tải' value={kb(s.sent)} />
        <Stat label='Tải thừa' value={<span className={wasted > 0 ? 'err' : 'ok'}>{kb(wasted)}</span>} />
        <Stat label='Request' value={s.requests} />
      </div>
      {s.ok != null && <p className={s.ok ? 'ok' : 'err'}>{s.ok ? 'Checksum khớp file gốc' : 'Checksum sai'}</p>}
    </div>
  );
}

const SEGMENTS = [
  { url: 'v720.webm', range: { start: 267, end: 18284 } },
  { url: 'v720.webm', range: { start: 18285, end: 60303 } },
  { url: 'v720.webm', range: { start: 60304, end: 99922 } },
  { url: 'v720.webm', range: { start: 120000, end: 137141 } },
  { url: 'v720.webm', range: { start: 137142, end: 171960 } },
  { url: 'v1080.webm', range: { start: 171961, end: 220000 } },
];

export default function PausableRangeDemo() {
  const { lines, add, clear } = useLog(40);
  const flags = useRef<Flags>({ ignoreRange: false, drop: false });
  const [ignoreRange, setIgnore] = useState(false);
  const [drop, setDrop] = useState(false);
  const [naive, setNaive] = useState<LaneStats>(EMPTY);
  const [pausable, setPausable] = useState<LaneStats>(EMPTY);
  const [gen, setGen] = useState(0);
  const lanes = useRef<Lane[]>([]);

  useEffect(() => {
    setNaive(EMPTY);
    setPausable(EMPTY);
    const ls = [naiveLane(flags, setNaive, add), pausableLane(flags, setPausable, add)];
    lanes.current = ls;
    return () => ls.forEach((l) => l.dispose());
  }, [gen, add]);

  flags.current = { ignoreRange, drop };
  const groups = groupContiguous(SEGMENTS);

  return (
    <div className='page prd'>
      <h1>Stream HTTP Range tạm dừng được</h1>
      <p className='hint'>
        Hai bên cùng tải một file giả 1 MB từ một server giả (~640 KB/s). Bấm Tạm dừng giữa chừng rồi Tiếp tục: bên trái gửi lại request từ đầu, bên phải gửi{' '}
        <code>Range</code> từ byte còn thiếu. Phía đọc của bên phải là một <code>ReadableStream</code> duy nhất, không biết đã có bao nhiêu request.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => lanes.current.forEach((l) => l.start())}>
          Bắt đầu / Tiếp tục
        </button>
        <button onClick={() => lanes.current.forEach((l) => l.pause())}>Tạm dừng</button>
        <button
          onClick={() => {
            clear();
            setGen((g) => g + 1);
          }}
        >
          Làm lại
        </button>
        <label className='switch'>
          <input type='checkbox' checked={ignoreRange} onChange={(e) => setIgnore(e.target.checked)} /> Server bỏ qua Range (trả 200)
        </label>
        <label className='switch'>
          <input type='checkbox' checked={drop} onChange={(e) => setDrop(e.target.checked)} /> Rớt mạng một lần ở 60%
        </label>
      </div>
      <div className='prd-lanes'>
        <LaneView title='Tải lại từ đầu' s={naive} note='abort() rồi fetch lại cả range; phía đọc phải bắt đầu lại.' />
        <LaneView title='PausableRangeStream' s={pausable} note='Request mới chỉ xin phần còn thiếu; byte đã nhận nằm yên trong hàng đợi.' />
      </div>
      <Log lines={lines} />
      <div className='card prd-merge'>
        <b>Gộp segment liền nhau thành một request</b>
        <p className='muted prd-note'>
          Bản gốc chỉ gộp khi <em>mọi</em> segment liền nhau; có một chỗ hở là không gộp gì. <code>groupContiguous</code> gộp theo từng đoạn: {SEGMENTS.length} segment →{' '}
          {groups.length} request.
        </p>
        <div className='prd-groups'>
          {groups.map((g, i) => (
            <div key={i} className='prd-group'>
              <code>
                {g.url} {rangeHeader(g.range)}
              </code>
              <span className='muted'>{g.items.length} segment</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

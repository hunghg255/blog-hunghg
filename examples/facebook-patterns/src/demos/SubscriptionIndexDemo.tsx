import { useEffect, useRef, useState } from 'react';
import { SubscriptionIndex, type Selector } from '../lib/subscriptionIndex';
import { TaskQueue } from '../lib/relayTaskQueue';
import { ResponseCache } from '../lib/relayResponseCache';
import { Log, Stat, useLog } from './shared';
import './SubscriptionIndexDemo.css';

type Tab = 'index' | 'queue' | 'cache';

export default function SubscriptionIndexDemo() {
  const [tab, setTab] = useState<Tab>('index');
  return (
    <div className='page si-demo'>
      <h1>Chỉ mục subscription, hàng đợi theo chiều sâu, cache LRU</h1>
      <p className='hint'>Ba mảnh hạ tầng trong store của Relay, mỗi tab một mảnh.</p>
      <div className='si-tabs' role='tablist'>
        {(
          [
            ['index', 'Chỉ mục theo record'],
            ['queue', 'Hàng đợi task'],
            ['cache', 'Cache response'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role='tab'
            aria-selected={tab === id}
            className={tab === id ? 'primary' : undefined}
            data-testid={`si-tab-${id}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'index' && <IndexTab />}
      {tab === 'queue' && <QueueTab />}
      {tab === 'cache' && <CacheTab />}
    </div>
  );
}

/* ---------------- Tab 1: chỉ mục ---------------- */

interface User {
  name: string;
  online: boolean;
  lastSeen: number;
  bestFriend: string | null;
}
const RECORDS = 16;
const COMPONENTS = 10;
const NAMES = [
  'An',
  'Bình',
  'Chi',
  'Dũng',
  'Giang',
  'Hà',
  'Khoa',
  'Lan',
  'Minh',
  'Nga',
  'Phúc',
  'Quý',
  'Sơn',
  'Thảo',
  'Uyên',
  'Vy',
];

function makeRecords(): Record<string, User> {
  const out: Record<string, User> = {};
  for (let i = 0; i < RECORDS; i++)
    out[`u${i}`] = { name: NAMES[i], online: i % 3 === 0, lastSeen: 0, bestFriend: null };
  return out;
}

/** Component k đọc u[k] và u[(k*3+1) % 16], cộng bạn thân của u[k] nếu có. */
function selectorFor(k: number): Selector<{ title: string; online: boolean; friend?: string }> {
  return (read) => {
    const me = read(`u${k}`) as User;
    const other = read(`u${(k * 3 + 1) % RECORDS}`) as User;
    const friend = me.bestFriend ? (read(me.bestFriend) as User).name : undefined;
    return {
      title: `${me.name} & ${other.name}`,
      online: me.online || other.online,
      ...(friend ? { friend } : {}),
    };
  };
}

/**
 * Mô phỏng dispose của bản trong bundle (viết lại, không phải mã gốc): gỡ theo tập seen lúc subscribe.
 * Phần còn lại giống bản viết lại.
 */
class BundleStyleIndex {
  byRecord = new Map<string, Set<{ seen: Set<string>; cb: () => void; sel: Selector<unknown> }>>();
  constructor(private get: (id: string) => unknown) {}
  private read(sel: Selector<unknown>) {
    const seen = new Set<string>();
    sel((id) => (seen.add(id), this.get(id)));
    return seen;
  }
  subscribe(sel: Selector<unknown>, cb: () => void) {
    const initial = this.read(sel);
    const sub = { seen: initial, cb, sel };
    initial.forEach((id) => this.add(id, sub));
    return () =>
      initial.forEach((id) => {
        this.byRecord.get(id)?.delete(sub);
      });
  }
  private add(id: string, sub: { seen: Set<string>; cb: () => void; sel: Selector<unknown> }) {
    if (!this.byRecord.has(id)) this.byRecord.set(id, new Set());
    this.byRecord.get(id)!.add(sub);
  }
  update(ids: string[]) {
    ids.forEach((id) =>
      [...(this.byRecord.get(id) ?? [])].forEach((sub) => {
        sub.seen.forEach((s) => this.byRecord.get(s)?.delete(sub));
        sub.seen = this.read(sub.sel);
        sub.seen.forEach((s) => this.add(s, sub));
        sub.cb();
      }),
    );
  }
}

type CardData = { title: string; online: boolean; friend?: string };

function IndexTab() {
  const records = useRef(makeRecords());
  const indexRef = useRef<SubscriptionIndex>(null);
  if (!indexRef.current) indexRef.current = new SubscriptionIndex((id) => records.current[id]);
  const [cards, setCards] = useState<CardData[]>(() =>
    Array.from({ length: COMPONENTS }, () => ({ title: '', online: false })),
  );
  const marks = useRef({ read: new Set<number>(), notified: new Set<number>() });
  const [flash, setFlash] = useState({
    read: new Set<number>(),
    notified: new Set<number>(),
    id: '',
  });
  const [totals, setTotals] = useState({ naiveReads: 0, indexReads: 0, notified: 0, updates: 0 });
  const { lines, add } = useLog(10);

  useEffect(() => {
    const idx = indexRef.current!;
    const disposers = Array.from({ length: COMPONENTS }, (_, k) => {
      const sel = selectorFor(k);
      const { data, dispose } = idx.subscribe(
        (read) => {
          marks.current.read.add(k);
          return sel(read);
        },
        (d) => {
          marks.current.notified.add(k);
          setCards((cs) => cs.map((c, i) => (i === k ? d : c)));
        },
      );
      setCards((cs) => cs.map((c, i) => (i === k ? data : c)));
      return dispose;
    });
    return () => disposers.forEach((d) => d());
  }, []);

  const seenOf = (k: number) => {
    const seen: string[] = [];
    selectorFor(k)((x) => (seen.push(x), records.current[x]));
    return seen;
  };

  const change = (id: string, kind: 'name' | 'lastSeen' | 'friend') => {
    const r = records.current;
    const rec = r[id];
    if (kind === 'name')
      r[id] = { ...rec, name: rec.name.endsWith('★') ? rec.name.slice(0, -1) : `${rec.name}★` };
    else if (kind === 'lastSeen') r[id] = { ...rec, lastSeen: rec.lastSeen + 1 };
    else r[id] = { ...rec, bestFriend: rec.bestFriend ? null : 'u15' };

    marks.current = { read: new Set(), notified: new Set() };
    const stats = indexRef.current!.update([id]);
    setFlash({ ...marks.current, id });
    setTotals((t) => ({
      naiveReads: t.naiveReads + COMPONENTS,
      indexReads: t.indexReads + stats.reads,
      notified: t.notified + stats.notified,
      updates: t.updates + 1,
    }));
    add(
      `Đổi ${kind} của ${id}: quét hết thì đọc lại ${COMPONENTS}, chỉ mục đọc lại ${stats.reads}, báo ${stats.notified}`,
      stats.notified === 0 ? 'muted' : 'ok',
    );
  };

  return (
    <section className='card si-section'>
      <h2>Đổi một record, ai phải đọc lại?</h2>
      <p className='hint'>
        10 component, mỗi cái đọc 2–3 record. Bấm tên để đổi <b>name</b> (component đọc nó phải cập
        nhật). Bấm ⏱ để đổi <b>lastSeen</b>, field không ai hiển thị: chỉ mục vẫn đọc lại, nhưng
        structural sharing chặn không cho báo.
      </p>
      <div className='si-records' data-testid='si-records'>
        {Object.entries(records.current).map(([id, u]) => (
          <span key={id} className={`si-rec ${flash.id === id ? 'hot' : ''}`}>
            <button data-testid={`si-name-${id}`} onClick={() => change(id, 'name')}>
              {id}: {u.name}
            </button>
            <button
              title='đổi lastSeen'
              data-testid={`si-seen-${id}`}
              onClick={() => change(id, 'lastSeen')}
            >
              ⏱
            </button>
          </span>
        ))}
      </div>
      <div className='toolbar'>
        <button data-testid='si-friend' onClick={() => change('u2', 'friend')}>
          u2 đổi bạn thân sang u15 (tập record đọc thay đổi)
        </button>
      </div>
      <div className='stats'>
        <Stat label='lần đổi' value={totals.updates} />
        <Stat label='quét hết: số lần đọc lại' value={totals.naiveReads} />
        <Stat label='chỉ mục: số lần đọc lại' value={totals.indexReads} />
        <Stat label='callback thật sự gọi' value={totals.notified} />
      </div>
      <div className='si-cards' data-testid='si-cards'>
        {cards.map((c, k) => (
          <div
            key={k}
            className={`si-comp ${flash.notified.has(k) ? 'notified' : flash.read.has(k) ? 'read' : ''}`}
            data-testid={`si-comp-${k}`}
          >
            <small>Component {k}</small>
            <div>{c.title}</div>
            <small className='muted'>
              đọc: {seenOf(k).join(', ')}
              {c.friend ? ` · bạn thân ${c.friend}` : ''}
            </small>
          </div>
        ))}
      </div>
      <p className='hint'>
        <span className='si-key read' /> bị đọc lại nhưng dữ liệu không đổi ·{' '}
        <span className='si-key notified' /> được báo và render lại
      </p>
      <GhostSection />
      <Log lines={lines} />
    </section>
  );
}

function GhostSection() {
  const [result, setResult] = useState<{ fixed: number; bundle: number } | null>(null);
  const run = () => {
    const make = () =>
      ({ A: { name: 'A', link: null as string | null }, B: { name: 'B' } }) as Record<string, any>;
    const sel: Selector<unknown> = (read) => {
      const a = read('A') as { name: string; link: string | null };
      return a.link ? { a: a.name, b: (read(a.link) as { name: string }).name } : { a: a.name };
    };
    // bản viết lại
    const s1 = make();
    let fixed = 0;
    const idx = new SubscriptionIndex((id) => s1[id]);
    const sub = idx.subscribe(sel, () => fixed++);
    s1.A = { ...s1.A, link: 'B' };
    idx.update(['A']);
    sub.dispose();
    s1.B = { name: 'B2' };
    idx.update(['B']);
    // bản kiểu bundle
    const s2 = make();
    let bundle = 0;
    const bidx = new BundleStyleIndex((id) => s2[id]);
    const dispose = bidx.subscribe(sel, () => bundle++);
    s2.A = { ...s2.A, link: 'B' };
    bidx.update(['A']);
    dispose();
    s2.B = { name: 'B2' };
    bidx.update(['B']);
    setResult({ fixed, bundle });
  };
  return (
    <div className='si-ghost'>
      <h3>Subscription "ma" sau dispose</h3>
      <p className='hint'>
        Kịch bản: subscribe (đọc A) → A trỏ sang B (giờ đọc A, B) → dispose → sửa B. Sau dispose,
        callback phải đứng yên ở 1 lần.
      </p>
      <button data-testid='si-ghost' onClick={run}>
        Chạy kịch bản
      </button>
      {result && (
        <div className='stats' data-testid='si-ghost-result'>
          <Stat
            label='viết lại: số lần callback'
            value={<strong className='ok'>{result.fixed}</strong>}
          />
          <Stat
            label='kiểu bundle: số lần callback'
            value={<strong className='err'>{result.bundle}</strong>}
          />
        </div>
      )}
    </div>
  );
}

/* ---------------- Tab 2: hàng đợi ---------------- */

interface QueueRun {
  done: string[];
  waiting: number;
}

function buildScenario(
  q: { enqueue: (...s: ((x: unknown) => unknown)[]) => Promise<unknown> },
  done: string[],
) {
  const step = (name: string, extra?: () => void) => (x: unknown) => {
    done.push(name);
    extra?.();
    return x;
  };
  q.enqueue(
    step('A1', () => {
      q.enqueue(step('A1.con-1'), step('A1.con-2'));
    }),
    step('A2'),
    step('A3'),
  );
  q.enqueue(step('B1'), step('B2'));
  q.enqueue(step('C1'));
}

/** Hàng đợi FIFO thường để so sánh: mọi bước mới đều xếp cuối hàng. */
class FifoQueue {
  items: (() => void)[] = [];
  enqueue(...steps: ((x: unknown) => unknown)[]) {
    let i = 0;
    const push = (v: unknown) => {
      if (i < steps.length) this.items.push(() => push(steps[i++](v)));
    };
    push(undefined);
    return Promise.resolve();
  }
  tick() {
    this.items.shift()?.();
  }
}

function QueueTab() {
  const pending = useRef<(() => void)[]>([]);
  const state = useRef<{ q: TaskQueue; fifo: FifoQueue; dq: string[]; df: string[] } | null>(null);
  const [view, setView] = useState<{ depth: QueueRun; fifo: QueueRun }>({
    depth: { done: [], waiting: 0 },
    fifo: { done: [], waiting: 0 },
  });
  const [auto, setAuto] = useState(false);

  const refresh = () => {
    const s = state.current!;
    setView({
      depth: { done: [...s.dq], waiting: s.q.size },
      fifo: { done: [...s.df], waiting: s.fifo.items.length },
    });
  };
  const reset = () => {
    pending.current = [];
    const q = new TaskQueue((cb) => pending.current.push(cb));
    const fifo = new FifoQueue();
    const dq: string[] = [];
    const df: string[] = [];
    buildScenario(q, dq);
    buildScenario(fifo, df);
    state.current = { q, fifo, dq, df };
    refresh();
  };
  if (!state.current) {
    // khởi tạo lười một lần
    pending.current = [];
    const q = new TaskQueue((cb) => pending.current.push(cb));
    const fifo = new FifoQueue();
    const dq: string[] = [];
    const df: string[] = [];
    buildScenario(q, dq);
    buildScenario(fifo, df);
    state.current = { q, fifo, dq, df };
  }
  const tick = () => {
    pending.current.shift()?.();
    state.current!.fifo.tick();
    refresh();
  };
  const finished =
    view.depth.waiting === 0 && pending.current.length === 0 && view.fifo.waiting === 0;
  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      if (pending.current.length === 0 && state.current!.fifo.items.length === 0) {
        setAuto(false);
        return;
      }
      tick();
    }, 450);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <section className='card si-section'>
      <h2>Mỗi tick chạy đúng một bước</h2>
      <p className='hint'>
        Task A có 3 bước; bước A1 sinh ra một task con 2 bước. Task B 2 bước, task C 1 bước. Bên
        trái là hàng đợi kiểu Relay (việc sinh ra trong lúc chạy chen lên đầu), bên phải là FIFO
        thường.
      </p>
      <div className='toolbar'>
        <button className='primary' data-testid='si-tick' onClick={tick} disabled={finished}>
          Tick
        </button>
        <button data-testid='si-auto' onClick={() => setAuto((a) => !a)} disabled={finished}>
          {auto ? 'Dừng' : 'Chạy tự động'}
        </button>
        <button data-testid='si-reset' onClick={() => (setAuto(false), reset())}>
          Làm lại
        </button>
      </div>
      <div className='si-qcols'>
        {(
          [
            ['Theo chiều sâu (RelayTaskQueue)', view.depth, 'si-depth'],
            ['FIFO thường', view.fifo, 'si-fifo'],
          ] as const
        ).map(([title, run, tid]) => (
          <div key={tid}>
            <h3>{title}</h3>
            <ol className='si-steps' data-testid={tid}>
              {run.done.map((d, i) => (
                <li
                  key={i}
                  className={
                    d.includes('con') ? 'child' : d[0] === 'A' ? 'a' : d[0] === 'B' ? 'b' : 'c'
                  }
                >
                  {d}
                </li>
              ))}
            </ol>
            <small className='muted'>còn {run.waiting} bước trong hàng</small>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Tab 3: cache ---------------- */

/** Mô phỏng RelayQueryResponseCache trong bundle (viết lại): get không làm mới thứ tự, quét cả Map mỗi lần get. */
class BundleStyleCache {
  map = new Map<string, number>();
  scanned = 0;
  constructor(private size: number) {}
  get(k: string) {
    this.map.forEach(() => this.scanned++); // vòng quét TTL
    return this.map.has(k);
  }
  set(k: string) {
    this.map.delete(k);
    this.map.set(k, Date.now());
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }
}

const PATTERN = [
  'Feed',
  'Profile',
  'Feed',
  'Groups',
  'Feed',
  'Watch',
  'Feed',
  'Market',
  'Feed',
  'Profile',
  'Feed',
  'Groups',
];

function CacheTab() {
  const lru = useRef(new ResponseCache<{ q: string }>({ size: 2, ttl: 60_000 }));
  const fifo = useRef(new BundleStyleCache(2));
  const [stats, setStats] = useState({ lruHit: 0, fifoHit: 0, reads: 0 });
  const [keys, setKeys] = useState<{ lru: string[]; fifo: string[] }>({ lru: [], fifo: [] });
  const { lines, add, clear } = useLog(14);

  const read = (q: string) => {
    const l = lru.current.get(q, {}) !== null;
    if (!l) lru.current.set(q, {}, { q });
    const f = fifo.current.get(q);
    if (!f) fifo.current.set(q);
    setStats((s) => ({
      lruHit: s.lruHit + (l ? 1 : 0),
      fifoHit: s.fifoHit + (f ? 1 : 0),
      reads: s.reads + 1,
    }));
    setKeys({
      lru: lru.current.keys().map((k) => JSON.parse(k).queryId),
      fifo: [...fifo.current.map.keys()],
    });
    add(
      `Đọc ${q}: LRU ${l ? 'hit' : 'miss'}, kiểu bundle ${f ? 'hit' : 'miss'}`,
      l && !f ? 'ok' : undefined,
    );
  };
  const reset = () => {
    lru.current = new ResponseCache({ size: 2, ttl: 60_000 });
    fifo.current = new BundleStyleCache(2);
    setStats({ lruHit: 0, fifoHit: 0, reads: 0 });
    setKeys({ lru: [], fifo: [] });
    clear();
  };

  return (
    <section className='card si-section'>
      <h2>Cache 2 mục: Feed được đọc liên tục</h2>
      <p className='hint'>
        Bản trong bundle gọi là cache có kích thước, nhưng <code>get</code> không đưa mục vừa đọc
        xuống cuối, nên mục được đọc nhiều nhất vẫn bị đuổi theo thứ tự chèn (FIFO).
      </p>
      <div className='toolbar'>
        {['Feed', 'Profile', 'Groups', 'Watch', 'Market'].map((q) => (
          <button key={q} data-testid={`si-read-${q}`} onClick={() => read(q)}>
            {q}
          </button>
        ))}
        <button className='primary' data-testid='si-pattern' onClick={() => PATTERN.forEach(read)}>
          Chạy 12 lần đọc (Feed xen kẽ)
        </button>
        <button onClick={reset}>Làm lại</button>
      </div>
      <div className='stats'>
        <Stat label='lần đọc' value={stats.reads} />
        <Stat label='LRU: hit' value={stats.lruHit} />
        <Stat label='kiểu bundle: hit' value={stats.fifoHit} />
        <Stat label='kiểu bundle: mục bị quét' value={fifo.current.scanned} />
      </div>
      <div className='si-qcols'>
        <div>
          <h3>LRU (viết lại), cũ → mới</h3>
          <div className='si-chips' data-testid='si-lru'>
            {keys.lru.map((k) => (
              <span key={k} className='badge'>
                {k}
              </span>
            ))}
          </div>
        </div>
        <div>
          <h3>Kiểu bundle, cũ → mới</h3>
          <div className='si-chips' data-testid='si-fifo'>
            {keys.fifo.map((k) => (
              <span key={k} className='badge'>
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
      <Log lines={lines} />
    </section>
  );
}

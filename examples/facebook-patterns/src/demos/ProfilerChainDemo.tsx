import { useMemo, useRef, useState } from 'react';
import {
  createProfiler,
  flushImpureCounts,
  memoizeSelector,
  type Handler,
} from '../lib/profilerChain';
import { Log, Stat, useLog } from './shared';
import './ProfilerChainDemo.css';

type Tab = 'chain' | 'memo';

export default function ProfilerChainDemo() {
  const [tab, setTab] = useState<Tab>('chain');
  return (
    <div className='page pc-demo'>
      <h1>Profiler kiểu middleware và memo selector có lấy mẫu kiểm tra</h1>
      <p className='hint'>
        Hai cách Facebook đo và kiểm chứng ngay trên production mà không làm chậm đường chạy chính.
      </p>
      <div className='pc-tabs' role='tablist'>
        <button
          role='tab'
          aria-selected={tab === 'chain'}
          className={tab === 'chain' ? 'primary' : undefined}
          data-testid='pc-tab-chain'
          onClick={() => setTab('chain')}
        >
          Chuỗi handler (RelayProfiler)
        </button>
        <button
          role='tab'
          aria-selected={tab === 'memo'}
          className={tab === 'memo' ? 'primary' : undefined}
          data-testid='pc-tab-memo'
          onClick={() => setTab('memo')}
        >
          Memo selector + canary
        </button>
      </div>
      {tab === 'chain' ? <ChainTab /> : <MemoTab />}
    </div>
  );
}

/* ---------------- Tab 1 ---------------- */

/**
 * Mô phỏng RelayProfiler.instrument trong bundle (viết lại, không phải mã gốc):
 * một ngăn xếp frame [n*, nTên, nRiêng, this, args, KẾT_QUẢ]; next() giảm bộ đếm từ ngoài vào trong.
 * Không chặn next() gọi hai lần, và frame không được pop khi hàm gốc ném lỗi.
 */
function bundleStyleProfiler() {
  const agg: Record<string, Handler[]> = { '*': [] };
  const SENTINEL = {};
  const stack: unknown[][] = [];
  return {
    stack,
    attachAggregateHandler: (n: string, h: Handler) => void (agg[n] ??= []).push(h),
    instrument<F extends (...a: any[]) => any>(name: string, fn: F) {
      agg[name] ??= [];
      const all = agg['*'];
      const named = agg[name];
      const local: Handler[] = [];
      const next = () => {
        const f = stack[stack.length - 1] as [number, number, number, unknown, unknown[], unknown];
        if (f[0]) all[--f[0]](name, next);
        else if (f[1]) named[--f[1]](name, next);
        else if (f[2]) local[--f[2]](name, next);
        else f[5] = fn.apply(f[3], f[4]);
      };
      const wrapper = function (this: unknown, ...args: unknown[]) {
        if (!all.length && !named.length && !local.length) return fn.apply(this, args);
        stack.push([all.length, named.length, local.length, this, args, SENTINEL]);
        next();
        const f = stack.pop()!;
        if (f[5] === SENTINEL)
          throw new Error('RelayProfiler: Handler did not invoke original function.');
        return f[5];
      };
      return Object.assign(wrapper, { attachHandler: (h: Handler) => void local.push(h) });
    },
  };
}

interface HandlerDef {
  id: string;
  label: string;
  scope: 'aggregate' | 'named' | 'local';
  make: (trace: (s: string) => void) => Handler;
}

const HANDLERS: HandlerDef[] = [
  {
    id: 'timing',
    label: '"*" đo thời gian (mọi hàm)',
    scope: 'aggregate',
    make: (t) => (name, next) => {
      const s = performance.now();
      t(`▶ timing ${name}`);
      next();
      t(`◀ timing ${name}: ${(performance.now() - s).toFixed(2)} ms`);
    },
  },
  {
    id: 'log',
    label: 'Theo tên "fetchFeed": ghi log',
    scope: 'named',
    make: (t) => (name, next) => {
      t(`▶ log ${name}`);
      next();
      t(`◀ log ${name}`);
    },
  },
  {
    id: 'trace',
    label: 'Gắn riêng: đếm lời gọi',
    scope: 'local',
    make: (t) => (_name, next) => {
      t('▶ counter');
      next();
      t('◀ counter');
    },
  },
  {
    id: 'forget',
    label: 'Lỗi: quên gọi next()',
    scope: 'local',
    make: (t) => () => {
      t('✗ handler quên gọi next');
    },
  },
  {
    id: 'twice',
    label: 'Lỗi: gọi next() hai lần',
    scope: 'local',
    make: (t) => (_name, next) => {
      t('▶ retry handler');
      next();
      next();
      t('◀ retry handler');
    },
  },
];

function runWith(kind: 'fixed' | 'bundle', enabled: Set<string>, throwInFn: boolean) {
  const lines: string[] = [];
  let depth = 0;
  const trace = (s: string) => {
    if (s.startsWith('◀')) depth--;
    lines.push(`${'  '.repeat(Math.max(0, depth))}${s}`);
    if (s.startsWith('▶')) depth++;
  };
  let originalCalls = 0;
  const original = (page: number) => {
    originalCalls++;
    trace(`• fetchFeed(${page}) chạy thật`);
    if (throwInFn) throw new Error('mạng lỗi');
    return `trang ${page}`;
  };
  const P = kind === 'fixed' ? createProfiler() : bundleStyleProfiler();
  const fn = P.instrument('fetchFeed', original);
  for (const h of HANDLERS) {
    if (!enabled.has(h.id)) continue;
    const handler = h.make(trace);
    if (h.scope === 'aggregate') P.attachAggregateHandler('*', handler);
    else if (h.scope === 'named') P.attachAggregateHandler('fetchFeed', handler);
    else fn.attachHandler(handler);
  }
  let outcome: string;
  try {
    outcome = `trả về "${fn(2)}"`;
  } catch (e) {
    outcome = `ném lỗi: ${(e as Error).message}`;
  }
  const leaked = kind === 'bundle' ? (P as ReturnType<typeof bundleStyleProfiler>).stack.length : 0;
  return { lines, outcome, originalCalls, leaked };
}

function ChainTab() {
  const [enabled, setEnabled] = useState(() => new Set(['timing', 'log', 'trace']));
  const [throwInFn, setThrowInFn] = useState(false);
  const [result, setResult] = useState<null | {
    fixed: ReturnType<typeof runWith>;
    bundle: ReturnType<typeof runWith>;
  }>(null);
  const toggle = (id: string) =>
    setEnabled((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <section className='card pc-section'>
      <h2>Gọi fetchFeed() qua chuỗi handler</h2>
      <p className='hint'>
        Thứ tự lồng: handler <code>"*"</code> ngoài cùng, rồi handler theo tên, rồi handler gắn
        riêng, cuối cùng là hàm gốc. Bật các handler lỗi để so bản kiểu bundle với bản viết lại.
      </p>
      <div className='pc-checks'>
        {HANDLERS.map((h) => (
          <label key={h.id} className='switch'>
            <input
              type='checkbox'
              data-testid={`pc-h-${h.id}`}
              checked={enabled.has(h.id)}
              onChange={() => toggle(h.id)}
            />
            {h.label}
          </label>
        ))}
        <label className='switch'>
          <input
            type='checkbox'
            data-testid='pc-throw'
            checked={throwInFn}
            onChange={(e) => setThrowInFn(e.target.checked)}
          />
          Hàm gốc ném lỗi
        </label>
      </div>
      <div className='toolbar'>
        <button
          className='primary'
          data-testid='pc-run'
          onClick={() =>
            setResult({
              fixed: runWith('fixed', enabled, throwInFn),
              bundle: runWith('bundle', enabled, throwInFn),
            })
          }
        >
          Gọi fetchFeed(2)
        </button>
      </div>
      {result && (
        <div className='pc-cols'>
          {(
            [
              ['Kiểu bundle', result.bundle, 'pc-out-bundle'],
              ['Viết lại', result.fixed, 'pc-out-fixed'],
            ] as const
          ).map(([title, r, tid]) => (
            <div key={tid} data-testid={tid}>
              <h3>{title}</h3>
              <pre className='pc-trace'>{r.lines.join('\n') || '(không có dòng nào)'}</pre>
              <div className={r.outcome.startsWith('ném') ? 'warn' : 'ok'}>{r.outcome}</div>
              <small className={r.originalCalls > 1 ? 'err' : 'muted'}>
                hàm gốc chạy {r.originalCalls} lần
                {tid === 'pc-out-bundle' && ` · frame còn kẹt trên stack: ${r.leaked}`}
              </small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------------- Tab 2 ---------------- */

/** Mô phỏng memoizeByIdentity trong bundle: Map mạnh, không giới hạn. */
function memoizeByIdentityBundle<A, R>(fn: (a: A) => R) {
  const m = new Map<A, R>();
  const wrapped = (a: A) => {
    if (!m.has(a)) m.set(a, fn(a));
    return m.get(a)!;
  };
  return Object.assign(wrapped, { size: () => m.size });
}

const campaignStore = { name: 'CampaignStore' };
const adStore = { name: 'AdStore' };

function MemoTab() {
  const [rate, setRate] = useState(0.05);
  const [freshProps, setFreshProps] = useState(true);
  const { lines, add, clear } = useLog(12);
  const counter = useRef(new Map<string, number>());
  const [snap, setSnap] = useState({
    pure: { calls: 0, computed: 0, canaryChecks: 0, impureDetected: 0 },
    lying: { calls: 0, computed: 0, canaryChecks: 0, impureDetected: 0 },
    bundleMapSize: 0,
    flushed: '',
  });

  const selectors = useMemo(() => {
    const onImpure = (name: string) =>
      add(`mustfix: selector "${name}" được khai báo thuần nhưng không thuần`, 'err');
    return {
      pure: memoizeSelector((_p: { id: number }) => [campaignStore, adStore], {
        name: 'campaignRows.getStores',
        isPure: true,
        sampleRate: rate,
        onImpure,
      }),
      lying: memoizeSelector(
        (p: { id: number }) => [campaignStore, p.id % 2 ? adStore : { ...adStore }],
        {
          name: 'adPreview.getStores',
          isPure: true,
          sampleRate: rate,
          onImpure,
        },
      ),
      impure: memoizeSelector((_p: { id: number }) => [campaignStore, { now: Date.now() }], {
        name: 'liveBudget.getStores',
        isPure: false,
        sampleRate: 0,
        callCounter: counter.current,
      }),
      bundle: memoizeByIdentityBundle((_p: { id: number }) => [campaignStore, adStore]),
    };
  }, [rate, add]);

  const run = (n: number) => {
    const shared = { id: 2 };
    for (let i = 0; i < n; i++) {
      const props = freshProps ? { id: 2 } : shared;
      selectors.pure(props);
      selectors.lying(props);
      selectors.impure(props);
      selectors.bundle(props);
      // render lại cùng props một lần nữa (trường hợp memo có ích)
      selectors.pure(props);
      selectors.lying(props);
    }
    setSnap((s) => ({
      ...s,
      pure: { ...selectors.pure.stats },
      lying: { ...selectors.lying.stats },
      bundleMapSize: selectors.bundle.size(),
    }));
    add(`Chạy ${n} lần render (${freshProps ? 'props mới mỗi lần' : 'cùng một props'})`);
  };

  const flush = () => {
    const out = flushImpureCounts(counter.current);
    setSnap((s) => ({ ...s, flushed: JSON.stringify(out) }));
    add(`Gửi báo cáo selector không thuần: ${JSON.stringify(out)}`, 'warn');
  };

  return (
    <section className='card pc-section'>
      <h2>Ba selector, một tỉ lệ lấy mẫu</h2>
      <p className='hint'>
        <code>campaignRows</code> thuần thật. <code>adPreview</code> khai báo thuần nhưng thỉnh
        thoảng trả object mới. <code>liveBudget</code> khai báo không thuần nên không memo, chỉ đếm
        số lần gọi.
      </p>
      <div className='toolbar'>
        <label className='pc-range'>
          Tỉ lệ canary {(rate * 100).toFixed(1)}%
          <input
            type='range'
            min={0}
            max={0.2}
            step={0.001}
            value={rate}
            data-testid='pc-rate'
            onChange={(e) => {
              setRate(Number(e.target.value));
              clear();
            }}
          />
        </label>
        <label className='switch'>
          <input
            type='checkbox'
            data-testid='pc-fresh'
            checked={freshProps}
            onChange={(e) => setFreshProps(e.target.checked)}
          />
          Props là object mới mỗi lần render
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' data-testid='pc-run100' onClick={() => run(100)}>
          100 lần render
        </button>
        <button data-testid='pc-run1000' onClick={() => run(1000)}>
          1.000 lần render
        </button>
        <button data-testid='pc-flush' onClick={flush}>
          Gửi báo cáo định kỳ (5 phút)
        </button>
      </div>
      <div className='pc-table-wrap'>
        <table className='pc-table' data-testid='pc-table'>
          <thead>
            <tr>
              <th>Selector</th>
              <th>Gọi</th>
              <th>Tính thật</th>
              <th>Canary</th>
              <th>Phát hiện sai</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ['campaignRows (thuần)', snap.pure],
                ['adPreview (khai báo sai)', snap.lying],
              ] as const
            ).map(([name, s]) => (
              <tr key={name}>
                <td>{name}</td>
                <td>{s.calls}</td>
                <td>{s.computed}</td>
                <td>{s.canaryChecks}</td>
                <td className={s.impureDetected ? 'err' : undefined}>{s.impureDetected}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className='stats'>
        <Stat label='Map của memoizeByIdentity (kiểu bundle)' value={snap.bundleMapSize} />
        <Stat label='báo cáo gần nhất' value={snap.flushed || '—'} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

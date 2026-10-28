import { useMemo, useRef, useState } from 'react';
import { createDispatcher, CycleError, type DispatchTiming } from '../lib/dispatchCycle';
import { createBufferedProxy } from '../lib/bufferedProxy';
import { Log, Stat, useLog } from './shared';
import './DispatchCycleDemo.css';

function busyWait(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* giả lập tính toán trong store */
  }
}

type Action = { type: 'SET_BUDGET'; campaign: string; amount: number };

interface Stores {
  summary: number; // tổng ngân sách, đăng ký TRƯỚC nên chạy trước nếu không waitFor
  budgets: Record<string, number>;
  currency: string;
}

export default function DispatchCycleDemo() {
  const { lines, add } = useLog();
  const [useWaitFor, setUseWaitFor] = useState(true);
  const [makeCycle, setMakeCycle] = useState(false);
  const [timings, setTimings] = useState<DispatchTiming[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const stores = useRef<Stores>({ summary: 300, budgets: { A: 100, B: 200 }, currency: 'VND' });
  const [, force] = useState(0);
  const flags = useRef({ useWaitFor, makeCycle });
  flags.current = { useWaitFor, makeCycle };

  const dispatcher = useMemo(() => {
    let last: DispatchTiming[] = [];
    const d = createDispatcher<Action>({ onCycle: (t) => (last = t) });
    const ran: string[] = [];
    d.register('SummaryStore', (_action, cycle) => {
      if (flags.current.useWaitFor) cycle.waitFor('BudgetStore');
      busyWait(2);
      stores.current.summary = Object.values(stores.current.budgets).reduce((a, b) => a + b, 0);
      ran.push('SummaryStore');
    });
    d.register('BudgetStore', (action, cycle) => {
      cycle.waitFor('CurrencyStore');
      if (flags.current.makeCycle) cycle.waitFor('SummaryStore');
      busyWait(4);
      stores.current.budgets = { ...stores.current.budgets, [action.campaign]: action.amount };
      ran.push('BudgetStore');
    });
    d.register('CurrencyStore', () => {
      busyWait(1);
      ran.push('CurrencyStore');
    });
    return {
      dispatch(action: Action) {
        ran.length = 0;
        last = [];
        try {
          d.dispatch(action);
        } finally {
          setTimings(last);
          setOrder([...ran]);
        }
      },
    };
  }, []);

  const send = (amount: number) => {
    try {
      dispatcher.dispatch({ type: 'SET_BUDGET', campaign: 'A', amount });
      const s = stores.current;
      const real = s.budgets.A + s.budgets.B;
      add(
        s.summary === real
          ? `Tổng = ${s.summary}: đúng`
          : `Tổng = ${s.summary} nhưng ngân sách thật là ${real}: SummaryStore chạy trước BudgetStore`,
        s.summary === real ? 'ok' : 'err',
      );
    } catch (e) {
      setOrder([]);
      add(e instanceof CycleError ? e.message : String(e), 'err');
    }
    force((n) => n + 1);
  };

  const s = stores.current;
  const max = Math.max(1, ...timings.map((t) => t.ms));

  return (
    <div className='page dispatch-demo'>
      <h1>Flux waitFor tự viết và proxy có đệm</h1>
      <p className='hint'>
        Ba store đăng ký theo thứ tự Summary → Budget → Currency. SummaryStore tính tổng từ
        BudgetStore, nên phải <code>waitFor('BudgetStore')</code>; nếu không, nó đọc ngân sách cũ.
      </p>
      <div className='toolbar'>
        <label>
          <input
            type='checkbox'
            checked={useWaitFor}
            onChange={(e) => setUseWaitFor(e.target.checked)}
          />{' '}
          Summary waitFor Budget
        </label>
        <label>
          <input
            type='checkbox'
            checked={makeCycle}
            onChange={(e) => setMakeCycle(e.target.checked)}
            data-testid='make-cycle'
          />{' '}
          Budget waitFor Summary (tạo vòng)
        </label>
      </div>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={() => send(100 + Math.round(Math.random() * 9) * 50)}
          data-testid='dispatch'
        >
          Dispatch SET_BUDGET(A)
        </button>
      </div>
      <div className='stats'>
        <Stat label='ngân sách A' value={<output data-testid='budget-a'>{s.budgets.A}</output>} />
        <Stat label='ngân sách B' value={<output>{s.budgets.B}</output>} />
        <Stat
          label='SummaryStore: tổng'
          value={<output data-testid='summary'>{s.summary}</output>}
        />
        <Stat
          label='thứ tự chạy xong'
          value={<output data-testid='order'>{order.join(' → ') || '—'}</output>}
        />
      </div>
      <div className='dispatch-bars'>
        {timings.map((t) => (
          <div key={t.name} className='dispatch-bar'>
            <span>{t.name}</span>
            <i style={{ width: `${(t.ms / max) * 100}%` }} />
            <b>{t.ms.toFixed(1)}ms</b>
          </div>
        ))}
      </div>
      <ProxySection onLog={add} />
      <Log lines={lines} />
    </div>
  );
}

/** Mô phỏng AdsFuncChannel (không phải mã gốc): lớp bọc chạy lại khi xả, giá trị trả về mất. */
function createFbStyleChannel(
  factory: (
    forward: Record<string, (...a: unknown[]) => unknown>,
  ) => Record<string, ((...a: unknown[]) => unknown) | null>,
) {
  const buffer: { method: string; args: unknown[] }[] = [];
  const buffering: Record<string, (...a: unknown[]) => unknown> = {};
  const forward: Record<string, (...a: unknown[]) => unknown> = {};
  let backend: Record<string, (...a: unknown[]) => unknown> = buffering;
  const methods = factory(forward);
  for (const name of Object.keys(methods)) {
    buffering[name] = (...args) => void buffer.push({ method: name, args });
    forward[name] = (...args) => backend[name](...args);
    if (methods[name] === null) methods[name] = forward[name];
  }
  return {
    methods: methods as Record<string, (...a: unknown[]) => unknown>,
    setBackend(b: Record<string, (...a: unknown[]) => unknown>) {
      backend = b;
      for (const call of buffer.splice(0)) methods[call.method]!(...call.args);
    },
  };
}

interface Logger {
  log(message: string): string;
}

function ProxySection({ onLog }: { onLog: (t: string, tone?: 'ok' | 'warn' | 'err') => void }) {
  const [fbOut, setFbOut] = useState<string[]>([]);
  const [ourOut, setOurOut] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const sinks = useMemo(() => {
    const fb = createFbStyleChannel((forward) => ({ log: (msg) => forward.log(`[ads] ${msg}`) }));
    const ours = createBufferedProxy<Logger>(['log']);
    return { fb, ours, fbReturns: [] as string[] };
  }, []);

  const call = () => {
    const n = sinks.fbReturns.length + 1;
    const fbResult = sinks.fb.methods.log(`lần ${n}`); // lớp bọc gắn tiền tố [ads]
    sinks.fbReturns.push(String(fbResult));
    // bản viết lại: tự thêm tiền tố ở chỗ gọi, không cần lớp bọc
    sinks.ours.proxy.log(`[ads] lần ${n}`).then((id) => {
      setOurOut((o) => [...o, `Promise → ${id}`]);
    });
    setPending(sinks.ours.pending);
    setFbOut((o) => [...o, `trả về: ${String(fbResult)}`]);
  };

  const load = async () => {
    setLoaded(true);
    onLog('Đang tải backend logger (800ms)…');
    await new Promise((r) => setTimeout(r, 800));
    const written: string[] = [];
    let id = 0;
    sinks.fb.setBackend({
      log: (m) => {
        written.push(String(m));
        return `id-${++id}`;
      },
    });
    let ourId = 0;
    sinks.ours.setBackend({ log: (m) => `${m} → id-${++ourId}` });
    setPending(0);
    setFbOut((o) => [...o, ...written.map((w) => `backend nhận: "${w}"`)]);
    onLog(
      written.some((w) => w.includes('[ads] [ads]'))
        ? 'Kiểu FB: lớp bọc chạy lại lúc xả hàng → tiền tố [ads] bị gắn hai lần'
        : 'Kiểu FB: đã xả hàng',
      'warn',
    );
  };

  return (
    <>
      <p className='hint'>
        Phần 2: gọi logger trước khi module thật tải xong. Kiểu FB: lời gọi trả{' '}
        <code>undefined</code>, và lớp bọc{' '}
        <code>{'log: (msg) => forward.log(`[ads] ${msg}`)'}</code> chạy lại lúc xả. Bản viết lại:
        mọi lời gọi trả Promise của kết quả thật.
      </p>
      <div className='toolbar'>
        <button onClick={call} data-testid='proxy-call'>
          Gọi log()
        </button>
        <button className='primary' onClick={load} disabled={loaded} data-testid='proxy-load'>
          Tải backend
        </button>
        <span className='badge' data-testid='pending'>
          đang đệm: {pending}
        </span>
      </div>
      <div className='dispatch-cols'>
        <div className='card'>
          <b>Kiểu Facebook</b>
          <pre data-testid='fb-out'>{fbOut.join('\n') || '—'}</pre>
        </div>
        <div className='card'>
          <b>Bản viết lại</b>
          <pre data-testid='our-out'>{ourOut.join('\n') || '—'}</pre>
        </div>
      </div>
    </>
  );
}

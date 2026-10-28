import { useEffect, useRef, useState } from 'react';
import { createIdleTimeouts, createListenerSet, IdleSubscriptions, useThrottledCallback, type Subscribable } from '../lib/disposeSafe';
import { FbIdleSubscriptions, fbFilterList, fbIdleTimeouts, fbSpliceList, useThrottledFb } from '../lib/disposeSafeFb';
import { Log, Stat, sleep, useLog } from './shared';
import './DisposeSafeDemo.css';

type Tab = 'list' | 'idle' | 'subs' | 'react';

export default function DisposeSafeDemo() {
  const [tab, setTab] = useState<Tab>('list');
  return (
    <div className='page dispose-demo'>
      <h1>Dispose cho đúng: listener, idle callback, subscription</h1>
      <div className='toolbar' role='tablist'>
        {(
          [
            ['list', '1. Gỡ listener'],
            ['idle', '2. Timer idle'],
            ['subs', '3. Subscription'],
            ['react', '4. Hook React'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} role='tab' aria-selected={tab === k} className={tab === k ? 'primary' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'list' && <ListTab />}
      {tab === 'idle' && <IdleTab />}
      {tab === 'subs' && <SubsTab />}
      {tab === 'react' && <ReactTab />}
    </div>
  );
}

// hàm có tên để in danh sách
function A() {}
function B() {}
function C() {}

function makeLists() {
  const splice = fbSpliceList();
  const filter = fbFilterList();
  const safe = createListenerSet();
  return {
    splice,
    filter,
    safe,
    disposers: {
      splice: [A, B, C].map((f) => splice.add(f)),
      filter: [A, B, C].map((f) => filter.add(f)),
      safe: [A, B, C].map((f) => safe.add(f)),
    },
  };
}

function ListTab() {
  const lists = useRef(makeLists());
  const [, force] = useState(0);
  const { lines, add } = useLog();
  const reset = () => {
    lists.current = makeLists();
    force((n) => n + 1);
    add('đã tạo lại [A, B, C]', 'muted');
  };
  const disposeA = () => {
    const d = lists.current.disposers;
    d.splice[0].dispose();
    d.filter[0].dispose();
    d.safe[0].dispose();
    force((n) => n + 1);
    add('gọi dispose() của A');
  };
  const L = lists.current;
  return (
    <section>
      <p className='hint'>
        Ba danh sách cùng có listener A, B, C. Bấm "dispose A" hai lần (ví dụ effect cleanup chạy hai lần, hay một component gỡ
        trong lúc đang phát sự kiện).
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={disposeA} data-testid='dispose-a'>
          dispose A
        </button>
        <button onClick={reset}>Tạo lại</button>
      </div>
      <table className='ds-table'>
        <tbody>
          <tr>
            <td>
              <code>splice(indexOf(fn), 1)</code>
            </td>
            <td data-testid='list-splice'>[{L.splice.names().join(', ')}]</td>
          </tr>
          <tr>
            <td>
              <code>filter(b =&gt; b === fn)</code>
            </td>
            <td data-testid='list-filter'>[{L.filter.names().join(', ')}]</td>
          </tr>
          <tr>
            <td>bản viết lại (entry riêng, dispose một lần)</td>
            <td data-testid='list-safe'>[{L.safe.names().join(', ')}]</td>
          </tr>
        </tbody>
      </table>
      <Log lines={lines} />
    </section>
  );
}

function IdleTab() {
  const [res, setRes] = useState<{ fb: number; fixed: number; ran: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    const fb = fbIdleTimeouts();
    const fixed = createIdleTimeouts();
    let ran = 0;
    for (let i = 0; i < 1000; i++) {
      fb.start(() => ran++, i % 20);
      fixed.start(() => ran++, i % 20);
    }
    // chờ tất cả chạy xong (idle có thể bị dồn, chờ tới khi đủ)
    for (let k = 0; k < 100 && ran < 2000; k++) await sleep(50);
    setRes({ fb: fb.pending, fixed: fixed.pending, ran });
    setBusy(false);
  };
  return (
    <section>
      <p className='hint'>
        <code>start(fn, ms)</code>: hẹn <code>setTimeout</code>, tới giờ thì xin thêm <code>requestIdleCallback</code>, và nhớ cặp{' '}
        <code>timeoutId → idleId</code> để <code>clear</code> huỷ được. Chạy 1.000 timer cho mỗi bên rồi đếm Map còn bao nhiêu entry.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={run} disabled={busy} data-testid='run-idle'>
          {busy ? 'Đang chạy…' : 'Chạy 1.000 timer'}
        </button>
      </div>
      {res && (
        <div className='stats'>
          <Stat label='callback đã chạy (cả hai bên)' value={res.ran} />
          <Stat label='Map bản gốc còn' value={<span className='err' data-testid='idle-fb'>{res.fb}</span>} />
          <Stat label='Map bản sửa còn' value={<span className='ok' data-testid='idle-fixed'>{res.fixed}</span>} />
        </div>
      )}
    </section>
  );
}

function SubsTab() {
  const [state, setState] = useState<{ fbOpen: number; fixedOpen: number; fbHandles: number; fixedPending: number } | null>(null);
  const { lines, add } = useLog();
  const scenario = async (cycles: number) => {
    const open = { fb: 0, fixed: 0 };
    const make = (side: 'fb' | 'fixed'): Subscribable => {
      let on = false;
      return {
        subscribe() {
          if (!on) open[side]++;
          on = true;
        },
        unsubscribe() {
          if (on) open[side]--;
          on = false;
        },
      };
    };
    const fb = new FbIdleSubscriptions();
    const fixed = new IdleSubscriptions();
    const fbD = Array.from({ length: 5 }, () => fb.add(make('fb')));
    const fixedD = Array.from({ length: 5 }, () => fixed.add(make('fixed')));
    if (cycles === 0) {
      // story hiện lên rồi bị gỡ ngay (cuộn nhanh qua)
      fb.activate();
      fixed.activate();
      fbD.forEach((d) => d.dispose());
      fixedD.forEach((d) => d.dispose());
      add('activate() rồi dispose() cả 5 subscription ngay, trước khi trình duyệt rảnh');
    } else {
      for (let i = 0; i < cycles; i++) {
        fb.activate();
        fixed.activate();
        fb.deactivate();
        fixed.deactivate();
      }
      add(`${cycles} lần activate → deactivate liên tiếp (story ra vào màn hình)`);
    }
    await sleep(300);
    setState({ fbOpen: open.fb, fixedOpen: open.fixed, fbHandles: fb.handleCount, fixedPending: fixed.pendingCount });
  };
  return (
    <section>
      <p className='hint'>
        Mỗi story có 5 subscription realtime (comment, reaction…). Khi story hiện, mỗi subscription được mở trong một{' '}
        <code>requestIdleCallback</code> riêng để không chặn lần render đầu.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => scenario(0)} data-testid='subs-dispose'>
          activate rồi dispose ngay
        </button>
        <button onClick={() => scenario(50)} data-testid='subs-cycles'>
          50 lần activate/deactivate
        </button>
      </div>
      {state && (
        <div className='stats'>
          <Stat label='bản gốc: subscription còn mở' value={<span data-testid='subs-fb-open'>{state.fbOpen}</span>} />
          <Stat label='bản sửa: subscription còn mở' value={<span data-testid='subs-fixed-open'>{state.fixedOpen}</span>} />
          <Stat label='bản gốc: handle idle trong tập' value={<span data-testid='subs-fb-handles'>{state.fbHandles}</span>} />
          <Stat label='bản sửa: lịch còn chờ' value={state.fixedPending} />
        </div>
      )}
      <Log lines={lines} />
    </section>
  );
}

function Typer({ fb, onCall }: { fb: boolean; onCall: () => void }) {
  const fbT = useThrottledFb(onCall, 200);
  const ours = useThrottledCallback(onCall, 200);
  const t = fb ? fbT : ours;
  useEffect(() => {
    // gõ 5 phím liên tiếp
    for (let i = 0; i < 5; i++) t();
  }, [t]);
  return <span className='badge'>ô tìm kiếm đang mở</span>;
}

function ReactTab() {
  const [mounted, setMounted] = useState<null | 'fb' | 'ours'>(null);
  const [result, setResult] = useState<{ fb?: number; ours?: number }>({});
  const live = useRef(false);
  const afterUnmount = useRef(0);
  const run = async (kind: 'fb' | 'ours') => {
    afterUnmount.current = 0;
    live.current = true;
    setMounted(kind);
    await sleep(30);
    live.current = false;
    setMounted(null); // đóng ô tìm kiếm khi lời gọi cuối còn treo
    await sleep(400);
    setResult((r) => ({ ...r, [kind]: afterUnmount.current }));
  };
  const onCall = () => {
    if (!live.current) afterUnmount.current++;
  };
  return (
    <section>
      <p className='hint'>
        Ô tìm kiếm gọi một hàm throttle 200 ms (log, gửi request). Gõ 5 phím rồi đóng ô sau 30 ms. Bản gốc gọi <code>cancel()</code>{' '}
        lúc mount và không trả cleanup, nên lời gọi cuối vẫn chạy sau khi component đã bị gỡ.
      </p>
      <div className='toolbar'>
        <button onClick={() => run('fb')} disabled={!!mounted} data-testid='react-fb'>
          Chạy với hook kiểu gốc
        </button>
        <button className='primary' onClick={() => run('ours')} disabled={!!mounted} data-testid='react-ours'>
          Chạy với useThrottledCallback
        </button>
        {mounted && <Typer fb={mounted === 'fb'} onCall={onCall} />}
      </div>
      <div className='stats'>
        <Stat label='hook gốc: lời gọi sau unmount' value={<span data-testid='react-fb-count'>{result.fb ?? '—'}</span>} />
        <Stat label='bản sửa: lời gọi sau unmount' value={<span data-testid='react-ours-count'>{result.ours ?? '—'}</span>} />
      </div>
      <p className='hint'>
        Cùng họ: <code>cleanups.concat(fn)</code> không gán lại (concat trả mảng mới) nên cleanup không bao giờ chạy. Dùng{' '}
        <code>push</code>, hoặc một túi cleanup chạy ngược thứ tự như <code>CleanupBag</code> trong bài.
      </p>
    </section>
  );
}

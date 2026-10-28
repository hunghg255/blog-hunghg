import { useEffect, useRef, useState } from 'react';
import { createImmediate } from '../lib/immediate';
import { createDragTracker } from '../lib/dragTracker';
import { Log, Stat, useLog } from './shared';
import './ImmediateDemo.css';

/**
 * Mô phỏng cách rút hàng đợi của ImmediateImplementation (không phải mã của Facebook):
 * việc được thêm trong lúc đang rút cũng chạy luôn trong cùng task.
 */
function createFbStyleImmediate() {
  let next = 1;
  const callbacks = new Map<number, () => void>();
  const queue: number[] = [];
  let flag = false;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    flag = false;
    while (queue.length) {
      const id = queue.shift()!;
      const cb = callbacks.get(id);
      callbacks.delete(id);
      cb?.();
    }
  };
  return {
    setImmediate(fn: () => void) {
      const id = next++;
      callbacks.set(id, fn);
      queue.push(id);
      if (!flag) {
        flag = true;
        channel.port2.postMessage(null);
      }
      return id;
    },
    dispose() {
      channel.port1.close();
    },
  };
}

const CHAIN = 300;

function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* giả lập việc nặng trong handler kéo */
  }
}

export default function ImmediateDemo() {
  const { lines, add } = useLog();
  const [chain, setChain] = useState<Record<string, string>>({});
  const [batch, setBatch] = useState<string>('—');
  const [running, setRunning] = useState(false);

  const runChain = async (kind: 'timeout' | 'immediate' | 'fb') => {
    setRunning(true);
    const imm =
      kind === 'immediate' ? createImmediate() : kind === 'fb' ? createFbStyleImmediate() : null;
    const schedule = (fn: () => void) => (imm ? imm.setImmediate(fn) : setTimeout(fn, 0));
    let frames = 0;
    let rafId = 0;
    const countFrames = () => {
      frames++;
      rafId = requestAnimationFrame(countFrames);
    };
    rafId = requestAnimationFrame(countFrames);
    const t0 = performance.now();
    await new Promise<void>((resolve) => {
      let n = 0;
      const step = () => {
        busy(0.05);
        if (++n < CHAIN) schedule(step);
        else resolve();
      };
      schedule(step);
    });
    const ms = performance.now() - t0;
    cancelAnimationFrame(rafId);
    imm?.dispose();
    const label =
      kind === 'timeout' ? 'setTimeout(0)' : kind === 'fb' ? 'kiểu FB' : 'createImmediate';
    const text = `${ms.toFixed(1)}ms · ${frames} frame vẽ được trong lúc chạy`;
    setChain((prev) => ({ ...prev, [kind]: text }));
    add(`${label}: chuỗi ${CHAIN} việc nối nhau mất ${text}`, kind === 'timeout' ? 'warn' : 'ok');
    setRunning(false);
  };

  const runBatch = () => {
    const imm = createImmediate();
    let done = 0;
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++)
      imm.setImmediate(() => {
        if (++done === 1000) {
          const text = `1000 việc · ${imm.wakes} message · ${(performance.now() - t0).toFixed(1)}ms`;
          setBatch(text);
          add(`Xếp 1000 việc cùng lúc: chỉ gửi ${imm.wakes} message để đánh thức`, 'ok');
          imm.dispose();
        }
      });
  };

  return (
    <div className='page imm-demo'>
      <h1>setImmediate tự viết và gom delta chuột theo frame</h1>
      <p className='hint'>
        Phần 1: chuỗi {CHAIN} việc, việc sau được hẹn ngay trong việc trước.{' '}
        <code>setTimeout(0)</code> lồng nhau bị trình duyệt kẹp tối thiểu 4ms; bản rút cạn hàng đợi
        kiểu Facebook nhanh nhưng không nhường cho trình duyệt vẽ; bản viết lại nhanh và vẫn nhường.
      </p>
      <div className='toolbar'>
        <button disabled={running} onClick={() => runChain('timeout')}>
          Chạy bằng setTimeout(0)
        </button>
        <button disabled={running} onClick={() => runChain('fb')}>
          Chạy kiểu Facebook
        </button>
        <button className='primary' disabled={running} onClick={() => runChain('immediate')}>
          Chạy bằng createImmediate
        </button>
        <button onClick={runBatch}>Xếp 1000 việc cùng lúc</button>
      </div>
      <div className='stats'>
        <Stat
          label='setTimeout(0)'
          value={<output data-testid='chain-timeout'>{chain.timeout ?? '—'}</output>}
        />
        <Stat
          label='kiểu Facebook'
          value={<output data-testid='chain-fb'>{chain.fb ?? '—'}</output>}
        />
        <Stat
          label='createImmediate'
          value={<output data-testid='chain-immediate'>{chain.immediate ?? '—'}</output>}
        />
        <Stat label='gom message' value={<output data-testid='batch'>{batch}</output>} />
      </div>
      <DragSection onLog={add} />
      <Log lines={lines} />
    </div>
  );
}

function DragSection({
  onLog,
}: {
  onLog: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void;
}) {
  return (
    <>
      <p className='hint'>
        Phần 2: kéo hai ô. Mỗi lần xử lý dịch chuyển tốn thêm 6ms (giả lập layout nặng). Ô trái xử
        lý từng <code>pointermove</code>; ô phải cộng dồn delta, xử lý tối đa một lần mỗi frame.
      </p>
      <div className='imm-arena'>
        <DragBox mode='naive' onLog={onLog} />
        <DragBox mode='batched' onLog={onLog} />
      </div>
    </>
  );
}

function DragBox({
  mode,
  onLog,
}: {
  mode: 'naive' | 'batched';
  onLog: (t: string, tone?: 'ok' | 'warn') => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 20, y: 20 });
  const [counts, setCounts] = useState({ events: 0, runs: 0 });

  useEffect(() => {
    const box = boxRef.current!;
    const apply = (dx: number, dy: number) => {
      busy(6);
      pos.current.x += dx;
      pos.current.y += dy;
      box.style.transform = `translate(${pos.current.x}px, ${pos.current.y}px)`;
    };
    let events = 0;
    let runs = 0;
    let last = { x: 0, y: 0 };
    const report = () => setCounts({ events, runs });

    if (mode === 'batched') {
      const tracker = createDragTracker(box, {
        onMove: (dx, dy) => {
          runs++;
          apply(dx, dy);
        },
        onEnd: () => {
          events = tracker.stats.events;
          report();
          onLog(`Gom theo frame: ${events} pointermove → chỉ xử lý ${runs} lần`, 'ok');
        },
      });
      const down = (e: PointerEvent) => {
        events = runs = 0;
        tracker.stats.events = tracker.stats.flushes = 0;
        tracker.start(e);
      };
      box.addEventListener('pointerdown', down);
      return () => box.removeEventListener('pointerdown', down);
    }

    const move = (e: PointerEvent) => {
      events++;
      runs++;
      apply(e.clientX - last.x, e.clientY - last.y);
      last = { x: e.clientX, y: e.clientY };
    };
    const up = (e: PointerEvent) => {
      box.removeEventListener('pointermove', move);
      box.removeEventListener('pointerup', up);
      box.releasePointerCapture(e.pointerId);
      report();
      onLog(`Từng sự kiện: ${events} pointermove → xử lý ${runs} lần`, 'warn');
    };
    const down = (e: PointerEvent) => {
      events = runs = 0;
      last = { x: e.clientX, y: e.clientY };
      box.setPointerCapture(e.pointerId);
      box.addEventListener('pointermove', move);
      box.addEventListener('pointerup', up);
      e.preventDefault();
    };
    box.addEventListener('pointerdown', down);
    return () => box.removeEventListener('pointerdown', down);
  }, [mode, onLog]);

  return (
    <div className='imm-lane'>
      <div className='imm-lane-title'>
        {mode === 'naive' ? 'Xử lý từng sự kiện' : 'Gom theo frame'}
      </div>
      <div ref={boxRef} className={`imm-box ${mode}`} data-testid={`box-${mode}`}>
        kéo tôi
      </div>
      <div className='imm-count' data-testid={`count-${mode}`}>
        {counts.events} sự kiện · {counts.runs} lần xử lý
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { decayingInterval, TRELLO_STEPS, type DecayingInterval, type DecayPhase } from '../lib/decayingInterval';
import { dynamicDebounce, trelloSearchWait } from '../lib/dynamicDebounce';
import { Log, Stat, useLog } from './shared';
import './DecayingPollDemo.css';

/** Tua nhanh 10 lần: 10 giây thật của Trello = 1 giây trong demo. */
const SPEED = 10;
const WINDOW = 240; // trục thời gian hiển thị 240 giây "ảo"

interface Mark {
  t: number; // giây ảo
  kind: 'naive' | 'decay' | 'wake';
}

// ---- Bản gốc của Trello (rút gọn, giữ nguyên logic) để thấy khe hở khi huỷ ----
function trelloDecayingInterval(fn: () => void, setT: (f: () => void, ms: number) => number) {
  let intervals: number[] = [];
  let idTimeout: number;
  const cancel = () => clearTimeout(idTimeout);
  const nextStep = () => {
    if (intervals.length) {
      const next = intervals.shift()!;
      idTimeout = setT(() => {
        fn();
        requestAnimationFrame(nextStep); // id của rAF không được lưu -> cancel() không huỷ được bước này
      }, next);
    }
  };
  intervals = TRELLO_STEPS.flatMap(({ iterations, every }) => Array<number>(iterations).fill(every));
  nextStep();
  return cancel;
}

function PollingSection({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [now, setNow] = useState(0);
  const [phase, setPhase] = useState<DecayPhase>('fast');
  const startRef = useRef(performance.now());
  const pollRef = useRef<DecayingInterval | null>(null);
  const [runKey, setRunKey] = useState(0);

  const virtualNow = () => ((performance.now() - startRef.current) / 1000) * SPEED;
  const mark = (kind: Mark['kind']) => setMarks((m) => [...m, { t: virtualNow(), kind }]);

  useEffect(() => {
    startRef.current = performance.now();
    setMarks([]);
    const scaled = (f: () => void, ms: number) => window.setTimeout(f, ms / SPEED);
    // cách ngây thơ: setInterval 10 giây, mãi mãi
    const naive = window.setInterval(() => mark('naive'), 10_000 / SPEED);
    const poll = decayingInterval(() => mark('decay'), { setTimer: scaled });
    pollRef.current = poll;
    const onWakeMark = () => {
      const p = poll.phase();
      if (p === 'slow' || p === 'stopped') mark('wake');
    };
    document.addEventListener('mousemove', onWakeMark, { capture: true });
    const tick = window.setInterval(() => {
      setNow(virtualNow());
      setPhase(poll.phase());
    }, 100);
    return () => {
      clearInterval(naive);
      clearInterval(tick);
      poll.cancel();
      document.removeEventListener('mousemove', onWakeMark, { capture: true });
    };
  }, [runKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = Math.max(0, now - WINDOW);
  const x = (t: number) => `${((t - from) / WINDOW) * 100}%`;
  const count = (k: Mark['kind']) => marks.filter((m) => m.kind === k).length;

  // khe hở khi huỷ: fn tự huỷ polling (vd card đã bị xoá nên component unmount)
  const cancelRace = (useOriginal: boolean) => {
    let calls = 0;
    let stop: () => void = () => {};
    const fn = () => {
      calls++;
      if (calls === 1) stop(); // huỷ ngay trong lần poll đầu tiên
    };
    const fast = (f: () => void, ms: number) => window.setTimeout(f, ms / 100);
    if (useOriginal) stop = trelloDecayingInterval(fn, fast);
    else {
      const p = decayingInterval(fn, { setTimer: fast, wakeEvents: [] });
      stop = () => p.cancel();
    }
    setTimeout(() => {
      stop();
      add(
        `${useOriginal ? 'Bản gốc' : 'Bản viết lại'}: huỷ ở lần poll 1, sau đó vẫn poll thêm ${calls - 1} lần`,
        calls > 1 ? 'err' : 'ok',
      );
    }, 2500);
  };

  return (
    <section className='card dp-card'>
      <h2>Polling: setInterval 10s vs thưa dần kiểu Trello (tua nhanh ×{SPEED})</h2>
      <p className='hint'>
        Ngồi yên, đừng rê chuột: sau 6 lần cách 10 giây, nhịp chậm lại còn 1 phút, rồi dừng hẳn. Rê chuột vào demo khi đang ở nhịp chậm
        hoặc đã dừng để đánh thức.
      </p>
      <div className='stats'>
        <Stat label='thời gian (giây ảo)' value={Math.round(now)} />
        <Stat label='setInterval: request' value={count('naive')} />
        <Stat label='thưa dần: request' value={count('decay')} />
        <Stat
          label='trạng thái'
          value={<span className={phase === 'fast' ? 'ok' : phase === 'slow' ? 'warn' : 'muted'}>{phase}</span>}
        />
      </div>
      <div className='dp-timeline' aria-label='Dòng thời gian các lần poll'>
        <div className='dp-row'>
          <span>setInterval</span>
          <div>
            {marks
              .filter((m) => m.kind === 'naive' && m.t >= from)
              .map((m, i) => (
                <i key={i} style={{ left: x(m.t) }} />
              ))}
          </div>
        </div>
        <div className='dp-row decay'>
          <span>thưa dần</span>
          <div>
            {marks
              .filter((m) => m.kind !== 'naive' && m.t >= from)
              .map((m, i) => (
                <i key={i} className={m.kind} style={{ left: x(m.t) }} />
              ))}
          </div>
        </div>
      </div>
      <div className='toolbar'>
        <button onClick={() => (pollRef.current?.wake(), mark('wake'))}>Đánh thức (như rê chuột)</button>
        <button onClick={() => setRunKey((k) => k + 1)}>Chạy lại từ đầu</button>
        <button onClick={() => cancelRace(true)}>Huỷ trong lúc poll: bản gốc</button>
        <button onClick={() => cancelRace(false)}>Huỷ trong lúc poll: bản viết lại</button>
      </div>
    </section>
  );
}

// ---- debounce ----

/** Bản gốc dynamicDebounce của Trello với immediate: true (rút gọn, giữ nguyên logic). */
function trelloImmediateDebounce(func: (q?: string) => void, wait: number) {
  let timeout: number | null = null;
  let args: [string] | null = null;
  const later = () => {
    timeout = null;
    func(...((args ?? []) as [string?])); // args đã bị xoá -> gọi không tham số
    args = null;
  };
  return (q: string) => {
    args = [q];
    const callNow = !timeout;
    if (timeout) clearTimeout(timeout);
    timeout = window.setTimeout(later, wait);
    if (callNow) {
      func(...args);
      args = null;
    }
  };
}

function DebounceSection({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [value, setValue] = useState('');
  const past = useRef<string[]>([]);
  const t0 = useRef(0);
  const fns = useRef<{ fixed: (q: string) => void; dynamic: (q: string) => void; original: (q: string) => void; leading: (q: string) => void } | null>(null);

  if (!fns.current) {
    const since = () => `${Math.round(performance.now() - t0.current)}ms`;
    fns.current = {
      fixed: dynamicDebounce((q: string) => add(`[cố định 300ms] tìm "${q}" (${since()} sau phím cuối)`, 'muted'), 300),
      dynamic: dynamicDebounce((q: string) => {
        past.current.push(q);
        add(`[kiểu Trello] tìm "${q}" (${since()} sau phím cuối)`, 'ok');
      }, trelloSearchWait(past.current)),
      original: trelloImmediateDebounce(
        (q) => add(q === undefined ? '[gốc, immediate] gọi lần cuối với tham số undefined' : `[gốc, immediate] tìm "${q}"`, q === undefined ? 'err' : 'warn'),
        300,
      ),
      leading: dynamicDebounce((q: string) => add(`[viết lại, leading] tìm "${q}"`, 'ok'), 300, { leading: true }),
    };
  }

  const onChange = (q: string) => {
    t0.current = performance.now();
    setValue(q);
    fns.current!.fixed(q);
    fns.current!.dynamic(q);
    fns.current!.original(q);
    fns.current!.leading(q);
  };

  return (
    <section className='card dp-card'>
      <h2>Debounce động (thời gian chờ phụ thuộc vào query)</h2>
      <p className='hint'>
        Kiểu Trello: query ≤ 3 ký tự, hoặc đang xoá lùi về một query đã tìm, thì chờ 1000ms; còn lại 500ms. Gõ một ký tự rồi dừng để thấy
        lỗi của bản gốc khi bật immediate.
      </p>
      <input type='text' aria-label='Tìm board' placeholder='Tìm board…' value={value} onChange={(e) => onChange(e.target.value)} />
    </section>
  );
}

export default function DecayingPollDemo() {
  const { lines, add } = useLog(30);
  return (
    <div className='page dp-page'>
      <h1>Polling thưa dần và debounce động</h1>
      <PollingSection add={add} />
      <DebounceSection add={add} />
      <Log lines={lines} />
    </div>
  );
}

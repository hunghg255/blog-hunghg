import { useEffect, useMemo, useRef, useState } from 'react';
import { CallbackQueue, exposeCallbacks, latestWins, singleFlight, withTimeout } from '../lib/asyncCoord';
import { Log, Stat, sleep, useLog } from './shared';
import './AsyncCoordDemo.css';

// ---------------------------------------------------------------------------
// 1. Slider điều khiển một việc lưu chậm
// ---------------------------------------------------------------------------

/** Bản gốc track-serially của Glitch (rút gọn, giữ nguyên logic) để so sánh. */
function glitchTrackSerially<A extends unknown[]>(f: (...a: A) => Promise<unknown>, onError: (e: unknown) => void) {
  const answer = Object.assign(
    (...args: A) => {
      if (answer.idle) {
        answer.pending = args;
        answer.idle = false;
        run().catch(onError);
      } else {
        answer.pending = args;
      }
    },
    { idle: true, pending: null as A | null },
  );
  async function run() {
    try {
      while (answer.pending !== null) {
        const temp = answer.pending;
        answer.pending = null;
        await f(...temp);
      }
    } finally {
      answer.idle = true;
    }
  }
  return answer;
}

type SliderMode = 'queue' | 'glitch' | 'latest';
const SAVE_MS = 400;

function SliderCard() {
  const [mode, setMode] = useState<SliderMode>('latest');
  const [failEvery3, setFailEvery3] = useState(true);
  const [ui, setUi] = useState(0);
  const [server, setServer] = useState(0);
  const [stats, setStats] = useState({ sent: 0, saves: 0, waiting: 0, errors: 0 });
  const saveCount = useRef(0);
  const [resetKey, setResetKey] = useState(0);

  const runner = useMemo(() => {
    // mỗi runner có cờ riêng: đổi chế độ/đặt lại thì các việc cũ đang chạy dở tự bỏ
    const token = { alive: true };
    const save = async (value: number) => {
      if (!token.alive) return;
      setStats((s) => ({ ...s, waiting: Math.max(0, s.waiting - 1) }));
      await sleep(SAVE_MS);
      if (!token.alive) return;
      saveCount.current++;
      if (failEvery3 && saveCount.current % 3 === 0) {
        setStats((s) => ({ ...s, errors: s.errors + 1 }));
        throw new Error(`Lưu ${value} lỗi`);
      }
      setServer(value);
      setStats((s) => ({ ...s, saves: s.saves + 1 }));
    };
    const onError = () => {};
    let run: (value: number) => void;
    if (mode === 'latest') run = latestWins(save, onError);
    else if (mode === 'glitch') run = glitchTrackSerially(save, onError);
    else {
      // hàng đợi tuần tự thường: mọi giá trị đều được lưu, lần lượt
      let chain = Promise.resolve();
      run = (value: number) => {
        chain = chain.then(() => save(value)).catch(onError);
      };
    }
    return { run, token };
  }, [mode, failEvery3, resetKey]);

  // runner mới thì số liệu về 0; runner cũ bị vô hiệu
  useEffect(() => {
    runner.token.alive = true;
    saveCount.current = 0;
    setStats({ sent: 0, saves: 0, waiting: 0, errors: 0 });
    setUi(0);
    setServer(0);
    return () => {
      runner.token.alive = false;
    };
  }, [runner]);

  const send = (value: number) => {
    setUi(value);
    setStats((s) => ({ ...s, sent: s.sent + 1, waiting: mode === 'queue' ? s.waiting + 1 : s.waiting }));
    runner.run(value);
  };

  // runner mới (useMemo ở trên) thì số liệu cũng về 0
  useEffect(() => {
    setStats({ sent: 0, saves: 0, waiting: 0, errors: 0 });
    setUi(0);
    setServer(0);
  }, [runner]);

  const sweep = async () => {
    for (let v = 0; v <= 100; v += 2) {
      send(v);
      await sleep(16);
    }
  };

  return (
    <section className='card ac-card'>
      <h2>1. Kéo slider, mỗi giá trị phải "lưu" lên server ({SAVE_MS}ms)</h2>
      <div className='toolbar' role='group' aria-label='Cách điều phối'>
        {(
          [
            ['queue', 'Hàng đợi tuần tự'],
            ['glitch', 'track-serially gốc (Glitch)'],
            ['latest', 'latestWins (viết lại)'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'primary' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
        <label className='switch'>
          <input type='checkbox' checked={failEvery3} onChange={(e) => setFailEvery3(e.target.checked)} /> Server lỗi ở mỗi lần lưu thứ 3
        </label>
      </div>
      <div className='toolbar'>
        <input type='range' min={0} max={100} value={ui} aria-label='Giá trị' onChange={(e) => send(+e.target.value)} />
        <button onClick={() => void sweep()}>Kéo nhanh 0 → 100</button>
        <button onClick={() => setResetKey((k) => k + 1)}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='giá trị trên UI' value={ui} />
        <Stat label='giá trị đã lưu' value={<span className={server === ui ? 'ok' : 'warn'}>{server}</span>} />
        <Stat label='lệnh gửi / lần lưu' value={`${stats.sent} / ${stats.saves}`} />
        <Stat label='đang xếp hàng' value={stats.waiting} />
        <Stat label='lỗi' value={stats.errors} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 2. Nhiều widget cùng cần một URL
// ---------------------------------------------------------------------------

type FetchMode = 'naive' | 'toptal' | 'single';

function WidgetsCard() {
  const [mode, setMode] = useState<FetchMode>('single');
  const [failFirst, setFailFirst] = useState(true);
  const [calls, setCalls] = useState(0);
  const [widgets, setWidgets] = useState<string[]>([]);
  const callCount = useRef(0);

  const api = async (url: string) => {
    const n = ++callCount.current;
    setCalls(n);
    await sleep(500);
    if (failFirst && n === 1) throw new Error('mạng lỗi');
    return `${url}: 42 kết quả`;
  };

  // Toptal: lodash memoize theo URL, giữ cả kết quả lỗi mãi mãi
  const toptalCache = useRef(new Map<string, Promise<string>>());
  const flight = useMemo(() => singleFlight(api), [failFirst]);

  const get = (url: string) => {
    if (mode === 'naive') return api(url);
    if (mode === 'single') return flight.get(url);
    if (!toptalCache.current.has(url)) toptalCache.current.set(url, api(url));
    return toptalCache.current.get(url)!;
  };

  const resetAll = () => {
    callCount.current = 0;
    setCalls(0);
    setWidgets([]);
    toptalCache.current.clear();
    flight.invalidate();
  };
  useEffect(resetAll, [mode, failFirst]);

  const mount = () => {
    setWidgets(Array(5).fill('đang tải…'));
    for (let i = 0; i < 5; i++) {
      get('/api/quiz-result').then(
        (value) => setWidgets((w) => w.map((x, j) => (j === i ? value : x))),
        (error: Error) => setWidgets((w) => w.map((x, j) => (j === i ? `lỗi: ${error.message}` : x))),
      );
    }
  };

  return (
    <section className='card ac-card'>
      <h2>2. Năm widget cùng gọi một URL</h2>
      <div className='toolbar' role='group' aria-label='Cách gọi'>
        {(
          [
            ['naive', 'Mỗi widget tự fetch'],
            ['toptal', 'memoize theo URL (Toptal)'],
            ['single', 'singleFlight (viết lại)'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'primary' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
        <label className='switch'>
          <input type='checkbox' checked={failFirst} onChange={(e) => setFailFirst(e.target.checked)} /> Request đầu tiên lỗi mạng
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={mount}>Mount 5 widget</button>
        <span className='muted'>Bấm 2 lần: lần 2 có tự thử lại sau lỗi không?</span>
      </div>
      <div className='stats'>
        <Stat label='request mạng' value={calls} />
      </div>
      <ul className='ac-widgets'>
        {widgets.map((w, i) => (
          <li key={i} className={w.startsWith('lỗi') ? 'err' : w.includes('kết quả') ? 'ok' : 'muted'}>
            Widget {i + 1}: {w}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 3. Chạy đúng một lần: khi analytics xác nhận hoặc sau 1 giây
// ---------------------------------------------------------------------------

function TimeoutCard({ add }: { add: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [blocked, setBlocked] = useState(true);
  const [useGuard, setUseGuard] = useState(true);

  const click = () => {
    const start = performance.now();
    const navigate = () => add(`→ chuyển trang sau ${Math.round(performance.now() - start)}ms`, 'ok');
    const callback = useGuard ? withTimeout(navigate, 1000) : navigate;
    // giả lập gtag('event', 'click', { event_callback }): bị adblock chặn thì callback không bao giờ chạy
    if (!blocked) setTimeout(callback, 300);
    if (!useGuard && blocked) add('Bấm link… (analytics bị chặn, callback không bao giờ tới: người dùng kẹt lại)', 'err');
    else add('Bấm link, đợi analytics…', 'muted');
  };

  return (
    <section className='card ac-card'>
      <h2>3. Bấm link: gửi analytics xong mới chuyển trang</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={blocked} onChange={(e) => setBlocked(e.target.checked)} /> Adblock chặn analytics
        </label>
        <label className='switch'>
          <input type='checkbox' checked={useGuard} onChange={(e) => setUseGuard(e.target.checked)} /> Bọc bằng withTimeout(1000)
        </label>
        <button className='primary' onClick={click}>
          Bấm link "Thuê freelancer"
        </button>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// 4. Hàng đợi lệnh kiểu window.x = window.x || []
// ---------------------------------------------------------------------------

function QueueCard({ add }: { add: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  // "window" giả để bấm Đặt lại được; trên trang thật là window
  const fakeWindow = useRef<Record<string, unknown>>({});
  const [state, setState] = useState<'chưa có gì' | 'mảng thường' | 'đã khởi tạo' | 'đã sẵn sàng'>('chưa có gì');
  const counter = useRef(0);

  const thirdPartyPush = (bad = false) => {
    const id = ++counter.current;
    const w = fakeWindow.current as { _onAnalyticsReady?: { push: (cb: (ga: string) => void) => void } };
    // đúng đoạn snippet bên thứ ba hay viết
    w._onAnalyticsReady = w._onAnalyticsReady || ([] as never);
    w._onAnalyticsReady.push((ga: string) => {
      if (bad) throw new Error(`callback #${id} lỗi`);
      add(`callback #${id} chạy với ${ga}`, 'ok');
    });
    add(`Script bên thứ ba push callback #${id}${bad ? ' (sẽ ném lỗi)' : ''}`, 'muted');
    if (state === 'chưa có gì') setState('mảng thường');
  };

  const init = async () => {
    const queue = exposeCallbacks<[string]>('_onAnalyticsReady', fakeWindow.current, (e) =>
      add(`Callback ném lỗi: ${(e as Error).message} (các callback khác vẫn chạy)`, 'warn'),
    );
    setState('đã khởi tạo');
    add('App: exposeCallbacks() chuyển mảng thành hàng đợi, đợi analytics 1 giây…', 'muted');
    await sleep(1000);
    queue.trigger('ga-instance');
    setState('đã sẵn sàng');
  };

  const reset = () => {
    fakeWindow.current = {};
    counter.current = 0;
    setState('chưa có gì');
  };

  const ready = fakeWindow.current._onAnalyticsReady instanceof CallbackQueue;
  return (
    <section className='card ac-card'>
      <h2>4. Hàng đợi lệnh cho script bên thứ ba</h2>
      <div className='toolbar'>
        <button onClick={() => thirdPartyPush()}>Bên thứ ba push callback</button>
        <button onClick={() => thirdPartyPush(true)}>Push callback lỗi</button>
        <button className='primary' disabled={ready} onClick={() => void init()}>
          App khởi tạo + trigger
        </button>
        <button onClick={reset}>Đặt lại</button>
      </div>
      <p className='muted'>window._onAnalyticsReady: {state}</p>
    </section>
  );
}

export default function AsyncCoordDemo() {
  const { lines, add } = useLog();
  return (
    <div className='page ac-page'>
      <h1>Điều phối async: latest-wins, single-flight, timeout, hàng đợi lệnh</h1>
      <SliderCard />
      <WidgetsCard />
      <TimeoutCard add={add} />
      <QueueCard add={add} />
      <Log lines={lines} />
    </div>
  );
}

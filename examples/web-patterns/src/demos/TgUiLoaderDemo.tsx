import { useEffect, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import {
  ANIMATION_LEVELS,
  applyAnimationLevel,
  resolveAnimationLevel,
  startUiLoader,
  type AnimationLevel,
  type ReadyState,
} from '../lib/tgUiLoader';
import './TgUiLoaderDemo.css';

// ---------------------------------------------------------------- 1. màn tải

type Mode = 'wait-all' | 'race';

const CHATS = ['Mẹ', 'Nhóm lớp 12A', 'Lan', 'Công việc', 'Tuấn', 'Saved Messages'];

function LoaderSection() {
  const [mode, setMode] = useState<Mode>('race');
  const [preloadMs, setPreloadMs] = useState(1800);
  const [fail, setFail] = useState(false);
  const [state, setState] = useState<ReadyState>(0);
  const [run, setRun] = useState(0);
  const [maskGoneAt, setMaskGoneAt] = useState<number | null>(null);
  const [preloadDoneAt, setPreloadDoneAt] = useState<number | null>(null);
  const log = useLog(12);
  // mỗi dòng nhớ nó xuất hiện lúc app còn "initial" hay không (initial thì không animate)
  const [rows, setRows] = useState(() => CHATS.map((name) => ({ name, initial: true })));
  const stateRef = useRef(state);
  stateRef.current = state;

  const addRow = () =>
    setRows((rs) => [{ name: `Tin mới ${rs.length - CHATS.length + 1}`, initial: stateRef.current < 2 }, ...rs]);

  useEffect(() => {
    if (run === 0) return;
    setRows(CHATS.map((name) => ({ name, initial: true })));
    setMaskGoneAt(null);
    setPreloadDoneAt(null);
    const t0 = performance.now();
    const preload = () =>
      new Promise<void>((resolve, reject) =>
        setTimeout(() => {
          setPreloadDoneAt(Math.round(performance.now() - t0));
          if (fail) reject(new Error('font 404'));
          else resolve();
        }, preloadMs),
      );
    const cancel = startUiLoader({
      preload,
      // "chờ hết": hạn chờ rất lớn (đừng dùng Infinity: setTimeout coi Infinity là 0)
      maxDelay: mode === 'race' ? 700 : 1e9,
      onReadyState: (s, info) => {
        setState(s);
        if (s === 1) {
          setMaskGoneAt(Math.round(info.elapsed));
          log.add(`nấc 1: bỏ mặt nạ sau ${Math.round(info.elapsed)}ms (${info.outcome})`, info.outcome === 'timeout' ? 'warn' : 'ok');
        }
        if (s === 2) log.add(`nấc 2: gỡ class "initial" sau ${Math.round(info.elapsed)}ms`, 'muted');
      },
    });
    return cancel;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  return (
    <section className='tgu-section'>
      <h2>1. Màn tải: chờ hết hay đua với 700ms</h2>
      <p className='hint'>
        Preload giả lập gồm bundle, font và 10 avatar. Chọn thời gian preload rồi bấm <b>Mở app</b>. Ở chế độ đua,
        mặt nạ biến mất sau tối đa 700ms dù preload chưa xong.
      </p>
      <div className='toolbar'>
        <label>
          <input type='radio' checked={mode === 'race'} onChange={() => setMode('race')} /> Đua 700ms (Telegram)
        </label>
        <label>
          <input type='radio' checked={mode === 'wait-all'} onChange={() => setMode('wait-all')} /> Chờ preload xong
        </label>
      </div>
      <div className='toolbar'>
        <label className='tgu-range'>
          Preload mất <b>{preloadMs}ms</b>
          <input type='range' min={100} max={3000} step={100} value={preloadMs} onChange={(e) => setPreloadMs(+e.target.value)} />
        </label>
        <label>
          <input type='checkbox' checked={fail} onChange={(e) => setFail(e.target.checked)} /> preload lỗi
        </label>
        <button className='primary' onClick={() => setRun((r) => r + 1)}>
          Mở app
        </button>
        <button onClick={addRow} disabled={run === 0}>
          Có tin mới
        </button>
      </div>
      <div className='stats'>
        <Stat label='mặt nạ biến mất sau' value={maskGoneAt === null ? '—' : `${maskGoneAt}ms`} />
        <Stat label='preload xong sau' value={preloadDoneAt === null ? '—' : `${preloadDoneAt}ms`} />
        <Stat label='nấc hiện tại' value={run === 0 ? '—' : state} />
      </div>
      <div className={`tgu-app ${state < 2 ? 'initial' : ''}`} data-testid='tgu-app'>
        <div className='tgu-col tgu-left'>
          {rows.map((r) => (
            <div key={r.name} className={`tgu-chat ${r.initial ? 'no-anim' : ''}`}>
              <span className='tgu-avatar'>{r.name[0]}</span>
              {r.name}
            </div>
          ))}
        </div>
        <div className='tgu-col tgu-middle'>
          <div className='tgu-bubble'>Tin nhắn hiện ra sau khi mặt nạ đi</div>
        </div>
        {run > 0 && state === 0 && (
          <div className='tgu-mask' data-testid='tgu-mask'>
            <div className='tgu-mask-left' />
            <div className='tgu-mask-middle' />
          </div>
        )}
        {run === 0 && <div className='tgu-idle'>Bấm "Mở app"</div>}
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 2. lỗi khi đổi trang sớm

/** Mô phỏng lại logic của bản gốc (không phải mã Telegram): `.then` không kiểm tra đã huỷ chưa. */
function startLikeOriginal(preload: () => Promise<unknown>, set: (s: ReadyState) => void) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  void Promise.race([new Promise((r) => setTimeout(r, 700)), preload().catch(() => {})]).then(() => {
    set(1);
    timeout = setTimeout(() => set(2), 1000);
  });
  return () => {
    if (timeout) clearTimeout(timeout);
    set(0);
  };
}

function UnmountSection() {
  const log = useLog(10);
  const [busy, setBusy] = useState(false);

  const runScenario = (fixed: boolean) => {
    setBusy(true);
    const tag = fixed ? 'bản sửa' : 'bản gốc';
    const t0 = performance.now();
    let unmounted = false;
    const set = (s: ReadyState) => {
      const t = Math.round(performance.now() - t0);
      if (unmounted && s !== 0) log.add(`[${tag}] ${t}ms: đặt nấc ${s} SAU khi đã rời trang`, 'err');
      else log.add(`[${tag}] ${t}ms: nấc ${s}`, s === 0 ? 'muted' : 'ok');
    };
    const preload = () => new Promise((r) => setTimeout(r, 1500));
    const cancel = fixed
      ? startUiLoader({ preload, onReadyState: (s) => set(s) })
      : startLikeOriginal(preload, set);
    setTimeout(() => {
      unmounted = true;
      log.add(`[${tag}] 300ms: rời trang (cleanup)`, 'warn');
      cancel();
    }, 300);
    setTimeout(() => setBusy(false), 2300);
  };

  return (
    <section className='tgu-section'>
      <h2>2. Rời trang khi đang tải</h2>
      <p className='hint'>
        Trang đăng nhập mở rồi chuyển sang trang khác sau 300ms (preload 1500ms). Bản gốc vẫn đặt nấc 1 và nấc 2 sau khi
        cleanup đã đặt về 0.
      </p>
      <div className='toolbar'>
        <button disabled={busy} onClick={() => runScenario(false)}>
          Chạy kiểu bản gốc
        </button>
        <button disabled={busy} className='primary' onClick={() => runScenario(true)}>
          Chạy bản sửa
        </button>
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 3. ba mức animation

function AnimationSection() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [saved, setSaved] = useState<AnimationLevel | undefined>(undefined);
  const [items, setItems] = useState<number[]>([1, 2, 3]);
  const [panel, setPanel] = useState(false);
  const level = resolveAnimationLevel(saved);

  useEffect(() => {
    if (rootRef.current) applyAnimationLevel(level, rootRef.current);
  }, [level]);

  return (
    <section className='tgu-section'>
      <h2>3. Ba mức animation bằng một class</h2>
      <p className='hint'>
        CSS viết theo mức: <code>.animation-level-0 …</code> tắt transition, mức 1 chỉ giữ fade, mức 2 có trượt và phóng
        to. "Theo hệ thống" đọc <code>prefers-reduced-motion</code>.
      </p>
      <div className='toolbar' role='radiogroup' aria-label='Mức animation'>
        <button aria-pressed={saved === undefined} className={saved === undefined ? 'primary' : ''} onClick={() => setSaved(undefined)}>
          Theo hệ thống
        </button>
        {([0, 1, 2] as const).map((l) => (
          <button key={l} aria-pressed={saved === l} className={saved === l ? 'primary' : ''} onClick={() => setSaved(l)}>
            {l}: {ANIMATION_LEVELS[l]}
          </button>
        ))}
      </div>
      <p className='muted'>
        Đang dùng: <b data-testid='tgu-level'>animation-level-{level}</b>
      </p>
      <div ref={rootRef} className='tgu-anim'>
        <div className='toolbar'>
          <button onClick={() => setItems((xs) => [...xs, xs.length + 1])}>Thêm tin</button>
          <button onClick={() => setPanel((p) => !p)}>{panel ? 'Đóng' : 'Mở'} cột phải</button>
        </div>
        <div className='tgu-anim-body'>
          <ul className='tgu-list'>
            {items.map((n) => (
              <li key={n} className='tgu-item'>
                Tin nhắn #{n}
              </li>
            ))}
          </ul>
          <aside className={`tgu-panel ${panel ? 'open' : ''}`}>Thông tin chat</aside>
        </div>
      </div>
    </section>
  );
}

export default function TgUiLoaderDemo() {
  return (
    <div className='page tgu'>
      <h1>Telegram: UiLoader đua 700ms, ba mức animation</h1>
      <LoaderSection />
      <UnmountSection />
      <AnimationSection />
    </div>
  );
}

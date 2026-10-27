import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCancelableFunction, createStickyEmitter, useFadeEffect, useInfiniteTrigger } from '../lib/uiUtilities';
import { Log, Stat, useLog } from './shared';
import './UiUtilitiesDemo.css';

/* ---------------------------------- Fade ---------------------------------- */

function FadePanel() {
  const [show, setShow] = useState(false);
  const [noTransition, setNoTransition] = useState(false);
  const [fallback, setFallback] = useState(true);
  const [shouldRender, visible, ref] = useFadeEffect(show, { fallbackMs: fallback ? 1000 : null });
  return (
    <section className='uu-panel'>
      <h2>1. Fade-out không bị kẹt</h2>
      <div className='toolbar'>
        <button className='primary' onClick={() => setShow((s) => !s)}>
          {show ? 'Ẩn toast' : 'Hiện toast'}
        </button>
        <label className='switch'>
          <input type='checkbox' checked={noTransition} onChange={(e) => setNoTransition(e.target.checked)} /> CSS tắt transition
        </label>
        <label className='switch'>
          <input type='checkbox' checked={fallback} onChange={(e) => setFallback(e.target.checked)} /> Timeout dự phòng 1s
        </label>
      </div>
      <div className='stats'>
        <Stat label='prop show' value={String(show)} />
        <Stat label='còn trong DOM' value={<bdi data-testid='fade-mounted'>{shouldRender ? 'có' : 'không'}</bdi>} />
      </div>
      <div className='uu-stage'>
        {shouldRender && (
          <div ref={ref} className={`uu-toast${visible ? ' in' : ''}${noTransition ? ' instant' : ''}`} role='status'>
            Đã lưu bài viết
          </div>
        )}
      </div>
    </section>
  );
}

/* --------------------------------- Sticky --------------------------------- */

type ConnEvents = { connection: { state: string; at: string } };

function Widget({ emitter, retro }: { emitter: ReturnType<typeof createStickyEmitter<ConnEvents>>; retro: boolean }) {
  const [state, setState] = useState('không biết');
  useEffect(() => {
    const on = (p: ConnEvents['connection']) => setState(`${p.state} (${p.at})`);
    return retro ? emitter.addRetroactiveListener('connection', on) : emitter.addListener('connection', on);
  }, [emitter, retro]);
  return (
    <li className={state === 'không biết' ? 'warn' : 'ok'}>
      {retro ? 'addRetroactiveListener' : 'addListener'}: {state}
    </li>
  );
}

function StickyPanel() {
  const emitter = useMemo(() => createStickyEmitter<ConnEvents>(), []);
  const [widgets, setWidgets] = useState<boolean[]>([]);
  return (
    <section className='uu-panel'>
      <h2>2. Sự kiện "dính" cho người đến muộn</h2>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={() => emitter.emitAndHold('connection', { state: 'đã kết nối', at: new Date().toLocaleTimeString('vi-VN', { hour12: false }) })}
        >
          Phát "đã kết nối"
        </button>
        <button onClick={() => setWidgets((w) => [...w, false])}>+ widget (addListener)</button>
        <button onClick={() => setWidgets((w) => [...w, true])}>+ widget (retroactive)</button>
      </div>
      <ul className='uu-widgets' data-testid='widgets'>
        {widgets.map((retro, i) => (
          <Widget key={i} emitter={emitter} retro={retro} />
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------- Cancelable -------------------------------- */

function SlowLoader({ cancelable, onLate }: { cancelable: boolean; onLate: () => void }) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const done = () => {
      if (!mounted.current) onLate(); // callback chạy khi component đã bị gỡ
    };
    const wrapped = cancelable ? createCancelableFunction(done) : null;
    // chú ý: không clearTimeout, giống callback do thư viện bên ngoài giữ (socket, SDK…)
    setTimeout(() => (wrapped ?? done)(), 800);
    return () => {
      mounted.current = false;
      wrapped?.cancel();
    };
  }, [cancelable, onLate]);
  return <div className='uu-loader'>Đang tải bình luận…</div>;
}

function CancelPanel() {
  const [open, setOpen] = useState(false);
  const [cancelable, setCancelable] = useState(true);
  const [late, setLate] = useState(0);
  const onLate = useCallback(() => setLate((n) => n + 1), []);
  return (
    <section className='uu-panel'>
      <h2>3. Callback huỷ được</h2>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={() => {
            setOpen(true);
            setTimeout(() => setOpen(false), 200); // đóng trước khi callback 800ms chạy
          }}
        >
          Mở rồi đóng nhanh
        </button>
        <label className='switch'>
          <input type='checkbox' checked={cancelable} onChange={(e) => setCancelable(e.target.checked)} /> Dùng createCancelableFunction
        </label>
      </div>
      <div className='stats'>
        <Stat label='callback chạy sau khi đã đóng' value={<bdi data-testid='late'>{late}</bdi>} />
      </div>
      {open && <SlowLoader cancelable={cancelable} onLate={onLate} />}
    </section>
  );
}

/* -------------------------------- Infinite -------------------------------- */

function InfinitePanel() {
  const [recheck, setRecheck] = useState(true);
  const [items, setItems] = useState<number[]>([1, 2]);
  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState(0);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { lines, add, clear } = useLog(10);
  const hasMore = items.length < 40;
  const loadMore = useCallback(() => {
    setLoading(true);
    setRequests((n) => n + 1);
    setTimeout(() => {
      setItems((prev) => {
        const next = [...prev, prev.length + 1, prev.length + 2];
        add(`tải trang mới, giờ có ${next.length} mục`, 'muted');
        return next;
      });
      setLoading(false);
    }, 250);
  }, [add]);
  const sentinel = useInfiniteTrigger<HTMLDivElement>({ hasMore, isLoading: loading, onLoadMore: loadMore, root, recheckAfterPaint: recheck });
  const reset = () => {
    setItems([1, 2]);
    setRequests(0);
    clear();
  };
  return (
    <section className='uu-panel'>
      <h2>4. Tải thêm không bị kẹt</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input
            type='checkbox'
            checked={recheck}
            onChange={(e) => {
              setRecheck(e.target.checked);
              reset();
            }}
          />{' '}
          Kiểm lại sau paint
        </label>
        <button onClick={reset}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='số mục' value={<bdi data-testid='items'>{items.length}</bdi>} />
        <Stat label='request' value={requests} />
      </div>
      <div className='uu-scroll' ref={setRoot} key={String(recheck)}>
        {items.map((n) => (
          <div key={n} className='uu-item'>
            Bài viết #{n}
          </div>
        ))}
        {hasMore && (
          <div ref={sentinel} className='uu-sentinel'>
            {loading ? 'Đang tải…' : 'sentinel'}
          </div>
        )}
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function UiUtilitiesDemo() {
  return (
    <div className='page'>
      <h1>Tiện ích UI nhỏ trong code Facebook</h1>
      <p className='hint'>
        Bốn mẩu nhỏ dùng khắp nơi: useFadeEffect, EventHolder, createCancelableFunction và CometInfiniteScrollTrigger. Mỗi ô có công tắc để thấy
        cách làm "ngây thơ" hỏng ở đâu.
      </p>
      <div className='uu-grid'>
        <FadePanel />
        <StickyPanel />
        <CancelPanel />
        <InfinitePanel />
      </div>
    </div>
  );
}

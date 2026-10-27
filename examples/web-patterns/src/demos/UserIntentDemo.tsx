import { useCallback, useEffect, useRef, useState } from 'react';
import { useExitIntent, useIdle, useWiggle } from '../lib/userIntent';
import { Log, useLog } from './shared';
import './UserIntentDemo.css';

const IDLE_MS = 3000;

/** Bản giống gốc để so sánh: debounce 300ms rồi mới đặt lại timer. */
function useIdleDebounced(ms: number) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    let idleTimer = setTimeout(() => setIdle(true), ms);
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    const prolong = () => {
      clearTimeout(debounceTimer);
      // chỉ chạy khi người dùng NGỪNG thao tác 300ms -> di chuột liên tục thì không bao giờ chạy
      debounceTimer = setTimeout(() => {
        setIdle(false);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => setIdle(true), ms);
      }, 300);
    };
    const events = ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'];
    events.forEach((e) => document.addEventListener(e, prolong));
    return () => {
      clearTimeout(idleTimer);
      clearTimeout(debounceTimer);
      events.forEach((e) => document.removeEventListener(e, prolong));
    };
  }, [ms]);
  return idle;
}

function IdleCard({ log }: { log: ReturnType<typeof useLog> }) {
  const legacyIdle = useIdleDebounced(IDLE_MS);
  const [idle, setIdle] = useState(false);
  useIdle(
    IDLE_MS,
    () => {
      setIdle(true);
      log.add('watchIdle: idle', 'warn');
    },
    () => {
      setIdle(false);
      log.add('watchIdle: hoạt động trở lại', 'ok');
    },
  );
  const prevLegacy = useRef(legacyIdle);
  const { add } = log;
  useEffect(() => {
    if (prevLegacy.current !== legacyIdle) add(`Kiểu debounce: ${legacyIdle ? 'idle' : 'hoạt động'}`, legacyIdle ? 'warn' : 'muted');
    prevLegacy.current = legacyIdle;
  }, [legacyIdle, add]);

  const badge = (value: boolean) => (
    <span className={`badge ${value ? 'err' : 'ok'}`}>{value ? 'idle' : 'đang hoạt động'}</span>
  );
  return (
    <section className='card ui-card' data-testid='idle'>
      <h3>1. Idle sau {IDLE_MS / 1000}s</h3>
      <p className='hint'>Đứng yên 3 giây: cả hai báo idle. Di chuột LIÊN TỤC: bản debounce chỉ nhận ra bạn quay lại khi bạn dừng tay, và nếu di liên tục quá 3 giây nó báo idle ngay lúc bạn đang di.</p>
      <div className='ui-row'>
        Debounce (kiểu gốc) {badge(legacyIdle)}
      </div>
      <div className='ui-row'>
        watchIdle {badge(idle)}
      </div>
    </section>
  );
}

function ExitCard({ log }: { log: ReturnType<typeof useLog> }) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 3000);
    return () => clearTimeout(id);
  }, []);
  useExitIntent(() => {
    if (shown) {
      log.add('Exit-intent lặp lại: bỏ qua (chỉ hiện 1 lần)', 'muted');
      return;
    }
    setShown(true);
    setOpen(true);
    log.add('Exit-intent: chuột rời qua mép trên', 'warn');
  });
  return (
    <section className='card ui-card' data-testid='exit'>
      <h3>2. Exit-intent</h3>
      <p className='hint'>
        Đưa chuột thật nhanh ra khỏi <b>mép trên</b> khung demo. Không tính trong 3 giây đầu và chỉ hiện một lần.
      </p>
      <div className='ui-row'>
        {ready ? <span className='badge ok'>đang theo dõi</span> : <span className='badge'>chờ 3 giây đầu…</span>}
        <button onClick={() => setShown(false)} disabled={!shown}>
          Cho hiện lại
        </button>
      </div>
      {open && (
        <div className='backdrop' onClick={() => setOpen(false)}>
          <div className='dialog' role='dialog' aria-label='Khoan đã' onClick={(e) => e.stopPropagation()}>
            <h2>Khoan đã! 👋</h2>
            <p>Trước khi đi, nhận bản tóm tắt bài viết qua email nhé?</p>
            <button className='primary' onClick={() => setOpen(false)}>
              Đóng
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function WiggleCard({ log }: { log: ReturnType<typeof useLog> }) {
  const areaRef = useRef<HTMLDivElement>(null);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const [ring, setRing] = useState<{ x: number; y: number; id: number } | null>(null);
  const last = useRef({ x: 0, y: 0 });
  const count = useRef(0);
  useEffect(() => setArea(areaRef.current), []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    last.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);
  useWiggle(
    () => {
      count.current++;
      setRing({ ...last.current, id: count.current });
      log.add(`Wiggle #${count.current}: phóng to con trỏ cho dễ thấy`, 'ok');
    },
    { target: area ?? undefined },
  );
  return (
    <section className='card ui-card' data-testid='wiggle'>
      <h3>3. Lắc chuột</h3>
      <p className='hint'>Lắc chuột qua lại thật nhanh trong ô dưới (6 lần đổi hướng trong 0,8 giây). Rung nhẹ không tính.</p>
      <div ref={areaRef} className='ui-wiggle-area' onPointerMove={onPointerMove}>
        {ring && <span key={ring.id} className='ui-ring' style={{ left: ring.x, top: ring.y }} />}
        <span className='muted'>{ring ? `Đã phát hiện ${ring.id} lần` : 'Lắc ở đây'}</span>
      </div>
    </section>
  );
}

export default function UserIntentDemo() {
  const log = useLog();
  return (
    <div className='page'>
      <h1>Đoán ý định người dùng</h1>
      <div className='ui-grid'>
        <IdleCard log={log} />
        <ExitCard log={log} />
        <WiggleCard log={log} />
      </div>
      <Log lines={log.lines} />
    </div>
  );
}

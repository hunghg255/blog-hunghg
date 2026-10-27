import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  WINDOW_SECONDS,
  activeSeconds,
  crc32,
  createActiveSecondSampler,
  createTimeSpentTracker,
  listenForActivity,
  type TimeSpentPayload,
} from '../lib/timeSpent';
import { Stat } from './shared';
import './TimeSpentDemo.css';

function BitWindow() {
  const [shipped, setShipped] = useState<{ payload: TimeSpentPayload; delay: number; bytes: number }[]>([]);
  const [rawEvents, setRawEvents] = useState(0);
  const tracker = useMemo(
    () =>
      createTimeSpentTracker({
        onShip: (payload, delay) =>
          setShipped((list) => [{ payload, delay, bytes: JSON.stringify(payload).length }, ...list].slice(0, 6)),
      }),
    [],
  );
  const current = useSyncExternalStore(tracker.subscribe, tracker.get, tracker.get);
  const [, tick] = useState(0);

  useEffect(() => {
    const stop = listenForActivity(() => tracker.update());
    // đếm số sự kiện thô để so với cách "gửi mỗi sự kiện"
    const count = () => setRawEvents((n) => n + 1);
    const evs = ['mousemove', 'scroll', 'click', 'keydown', 'pointermove'];
    evs.forEach((e) => window.addEventListener(e, count, { capture: true, passive: true }));
    const flush = () => document.visibilityState === 'hidden' && tracker.ship();
    document.addEventListener('visibilitychange', flush);
    window.addEventListener('pagehide', tracker.ship);
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => {
      stop();
      evs.forEach((e) => window.removeEventListener(e, count, { capture: true }));
      document.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', tracker.ship);
      clearInterval(id);
      tracker.destroy();
    };
  }, [tracker]);

  const nowSecond = Math.floor(Date.now() / 1000);
  const active = new Set(current ? activeSeconds(current) : []);
  const totalActive = shipped.reduce((n, s) => n + activeSeconds(s.payload).length, 0) + active.size;

  return (
    <section className='card'>
      <h2>1. Bitmap 64 giây</h2>
      <p className='hint'>
        Rê chuột, cuộn hoặc gõ phím: mỗi giây có hoạt động bật một ô. Cửa sổ đầu tiên đóng sau 8 giây (gửi ngay), các cửa
        sổ sau đóng sau 64 giây.
      </p>
      <div className='ts-grid' role='img' aria-label={`Cửa sổ hiện tại: ${active.size} giây có hoạt động`}>
        {Array.from({ length: WINDOW_SECONDS }, (_, i) => {
          const isPast = current ? current.start_time + i <= nowSecond : false;
          return <span key={i} className={active.has(i) ? 'on' : isPast ? 'past' : ''} />;
        })}
      </div>
      <div className='toolbar'>
        <button onClick={() => tracker.ship()}>Gửi ngay (giả lập đóng tab)</button>
        <span className='muted'>
          {current ? `cửa sổ #${current.tos_seq}, đã mở ${Math.max(0, nowSecond - current.start_time)}s` : 'chưa có cửa sổ: chờ hoạt động đầu tiên'}
        </span>
      </div>
      <div className='stats'>
        <Stat label='sự kiện DOM thô' value={rawEvents} />
        <Stat label='giây có hoạt động' value={totalActive} />
        <Stat label='payload đã gửi' value={shipped.length} />
      </div>
      {shipped.length > 0 && (
        <div className='ts-payloads'>
          {shipped.map((s, i) => (
            <pre key={i}>
              {`// ${s.bytes} byte, delay ${s.delay}ms\n`}
              {JSON.stringify({ ...s.payload, tos_array: s.payload.tos_array.map((n) => '0b' + n.toString(2)) }, null, 1)}
            </pre>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------- 2. Lấy mẫu theo bucket crc32(userId) % 2003 ----------

const MODULO = 2003;
const BINS = 40;

function simulate(users: number, anonymousShare: number, buggy: boolean) {
  // mỗi user hoạt động liên tục trong một chu kỳ 2003 giây; đếm số báo cáo mỗi giây
  const perSecond = new Uint32Array(MODULO);
  for (let u = 0; u < users; u++) {
    const anonymous = u < users * anonymousShare;
    const id = anonymous ? '0' : `1000${u * 7919}`;
    if (anonymous && !buggy) continue; // bản sửa: user ẩn danh không lấy mẫu
    perSecond[crc32(id) % MODULO]++; // với cả chu kỳ, user báo đúng 1 giây: giây = bucket
  }
  const bins = new Array(BINS).fill(0);
  perSecond.forEach((n, s) => (bins[Math.floor((s / MODULO) * BINS)] += n));
  return { bins, max: Math.max(...perSecond), mean: perSecond.reduce((a, n) => a + n, 0) / MODULO };
}

function SamplerSim() {
  const [buggy, setBuggy] = useState(true);
  const [anon, setAnon] = useState(0.3);
  const users = 10000;
  const sim = useMemo(() => simulate(users, anon, buggy), [anon, buggy]);
  const top = Math.max(...sim.bins, 1);
  const sampler = useRef(createActiveSecondSampler('100042'));

  return (
    <section className='card'>
      <h2>2. Lấy mẫu "giây hoạt động" không cần random</h2>
      <p className='hint'>
        {users.toLocaleString('vi-VN')} người dùng hoạt động liên tục. Mỗi người chỉ báo giây có{' '}
        <code>giây % 2003 === crc32(userId) % 2003</code> (ví dụ user <code>100042</code> báo giây có số dư{' '}
        {sampler.current.bucket}). Bản gốc bật lấy mẫu khi <code>{'id !== "" || id !== "0"'}</code>: điều kiện luôn
        đúng, kể cả với người chưa đăng nhập (id <code>"0"</code>).
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={buggy} onChange={(e) => setBuggy(e.target.checked)} /> Dùng điều kiện của bản gốc
        </label>
        <label>
          Người chưa đăng nhập {Math.round(anon * 100)}%
          <input type='range' min={0} max={0.6} step={0.05} value={anon} onChange={(e) => setAnon(+e.target.value)} />
        </label>
      </div>
      <div className='ts-bars' role='img' aria-label='Số báo cáo theo thời gian trong một chu kỳ 2003 giây'>
        {sim.bins.map((n, i) => (
          <span key={i} style={{ height: `${(n / top) * 100}%` }} title={`${n} báo cáo`} />
        ))}
      </div>
      <div className='stats'>
        <Stat label='TB báo cáo / giây' value={sim.mean.toFixed(1)} />
        <Stat label='giây đông nhất' value={sim.max} />
      </div>
      <p className='hint'>
        {buggy && anon > 0
          ? 'Mọi user id "0" rơi vào cùng một bucket: một giây duy nhất nhận cả nghìn báo cáo, các giây còn lại thiếu mẫu.'
          : 'Bucket rải đều: mỗi giây chỉ vài báo cáo, server có mẫu liên tục mà client không cần random.'}
      </p>
    </section>
  );
}

export default function TimeSpentDemo() {
  return (
    <div className='page time-spent'>
      <h1>Đo thời gian dùng bằng bitmap</h1>
      <BitWindow />
      <SamplerSim />
    </div>
  );
}

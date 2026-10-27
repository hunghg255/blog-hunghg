import { useEffect, useRef, useState } from 'react';
import { createUpdateBatcher, type UpdateBatcher } from '../lib/tgUpdateBatcher';
import { Stat } from './shared';
import './TgUpdateBatchingDemo.css';

interface Update {
  type: 'userStatus' | 'typing' | 'views' | 'newMessage';
  at: number;
  chatId: number;
}

const WINDOW_MS = 4000;
const RENDER_COST_MS = 3; // giả lập chi phí một lần cập nhật giao diện

function busy(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    // bận
  }
}

type Mark = { kind: 'update' | 'urgent' | 'flush'; at: number; size?: number };

export default function TgUpdateBatchingDemo() {
  const [batching, setBatching] = useState(true);
  const [urgentFast, setUrgentFast] = useState(true);
  const [rate, setRate] = useState(60);
  const [running, setRunning] = useState(true);
  const [, setTick] = useState(0);
  const marks = useRef<Mark[]>([]);
  const stats = useRef({ updates: 0, flushes: 0, cpu: 0, since: performance.now(), urgentDelay: [] as number[] });
  const statuses = useRef(new Map<number, string>());
  const messages = useRef<string[]>([]);
  const batcherRef = useRef<UpdateBatcher<Update> | null>(null);

  const apply = (batch: Update[]) => {
    const now = performance.now();
    busy(RENDER_COST_MS);
    stats.current.flushes++;
    stats.current.cpu += RENDER_COST_MS;
    for (const u of batch) {
      if (u.type === 'newMessage') {
        messages.current = [`Tin mới ở nhóm ${u.chatId}`, ...messages.current].slice(0, 4);
        stats.current.urgentDelay = [...stats.current.urgentDelay, now - u.at].slice(-10);
      } else {
        statuses.current.set(u.chatId, u.type === 'typing' ? 'đang gõ…' : u.type === 'views' ? '👁 +1' : 'online');
      }
    }
    marks.current.push({ kind: 'flush', at: now, size: batch.length });
    setTick((t) => t + 1);
  };

  useEffect(() => {
    const batcher = batching
      ? createUpdateBatcher<Update>({ flush: apply, isUrgent: (u) => urgentFast && u.type === 'newMessage' })
      : null;
    batcherRef.current = batcher;
    stats.current = { updates: 0, flushes: 0, cpu: 0, since: performance.now(), urgentDelay: [] };
    marks.current = [];
    return () => batcher?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batching, urgentFast]);

  const emit = (update: Update) => {
    stats.current.updates++;
    marks.current.push({ kind: update.type === 'newMessage' ? 'urgent' : 'update', at: update.at });
    if (batcherRef.current) batcherRef.current.push(update);
    else apply([update]); // không gom: mỗi update một lần cập nhật giao diện
  };

  // nguồn update: mỗi update tới trong một task riêng, giống message từ WebSocket hay worker
  useEffect(() => {
    if (!running) return;
    const types: Update['type'][] = ['userStatus', 'typing', 'views'];
    const timer = setInterval(() => {
      emit({ type: types[Math.floor(Math.random() * 3)], at: performance.now(), chatId: 1 + Math.floor(Math.random() * 8) });
    }, 1000 / rate);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, rate]);

  // vẽ lại timeline
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const cutoff = performance.now() - WINDOW_MS;
      while (marks.current.length && marks.current[0].at < cutoff) marks.current.shift();
      setTick((t) => t + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const now = performance.now();
  const seconds = Math.max(0.5, (now - stats.current.since) / 1000);
  const delays = stats.current.urgentDelay;
  const avgDelay = delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null;
  const x = (at: number) => `${(100 * (at - (now - WINDOW_MS))) / WINDOW_MS}%`;

  return (
    <div className='page tg-batch'>
      <h1>Gom update realtime theo nhịp</h1>
      <p className='hint'>
        {rate} update/giây (online, đang gõ, lượt xem), mỗi cái tới trong một task riêng. Không gom: mỗi update một lần cập
        nhật giao diện. Gom: tối đa một lần mỗi 425ms. Bấm <b>Tin mới</b>: update gấp mở nhịp mới nên vẫn hiện ngay.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={batching} onChange={(e) => setBatching(e.target.checked)} /> Gom 425ms
        </label>
        <label className='switch'>
          <input type='checkbox' checked={urgentFast} disabled={!batching} onChange={(e) => setUrgentFast(e.target.checked)} /> Tin mới
          mở nhịp mới
        </label>
        <label>
          Tốc độ: <b>{rate}/giây</b>
          <input type='range' min={5} max={200} step={5} value={rate} onChange={(e) => setRate(+e.target.value)} />
        </label>
        <button type='button' onClick={() => setRunning((v) => !v)}>
          {running ? '⏸ Dừng' : '▶ Chạy'}
        </button>
        <button
          type='button'
          className='primary'
          onClick={() => emit({ type: 'newMessage', at: performance.now(), chatId: 1 + Math.floor(Math.random() * 8) })}
        >
          ✉ Tin mới
        </button>
      </div>

      <div className='stats'>
        <Stat label='update/giây' value={(stats.current.updates / seconds).toFixed(0)} />
        <Stat label='lần cập nhật UI/giây' value={(stats.current.flushes / seconds).toFixed(1)} />
        <Stat label='CPU cho UI (ms/giây)' value={(stats.current.cpu / seconds).toFixed(0)} />
        <Stat label='tin mới hiện sau' value={avgDelay === null ? '—' : `${avgDelay.toFixed(1)}ms`} />
      </div>

      <div className='tg-batch-timeline' aria-label='Timeline 4 giây gần nhất'>
        {marks.current.map((m, i) => (
          <span
            key={i}
            className={`tg-batch-mark ${m.kind}`}
            style={{ left: x(m.at) }}
            title={m.kind === 'flush' ? `xả ${m.size} update` : m.kind}
          />
        ))}
      </div>
      <div className='tg-batch-legend'>
        <span className='update'>update</span>
        <span className='urgent'>tin mới (gấp)</span>
        <span className='flush'>cập nhật giao diện</span>
      </div>

      <div className='split'>
        <div className='card'>
          <h3>Trạng thái</h3>
          <ul className='tg-batch-list'>
            {Array.from({ length: 8 }, (_, i) => (
              <li key={i}>
                Nhóm {i + 1}: <span className='muted'>{statuses.current.get(i + 1) ?? '—'}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className='card'>
          <h3>Tin mới</h3>
          <ul className='tg-batch-list'>
            {messages.current.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

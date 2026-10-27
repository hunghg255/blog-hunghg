import { useEffect, useRef, useState } from 'react';
import { IntervalTrackingBuffer, type RecordingWindow } from '../lib/traceRingBuffer';
import { Log, Stat, useLog } from './shared';
import './TraceRingBufferDemo.css';

interface OpenTrace {
  name: string;
  window: RecordingWindow<string>;
  /** cách ngây thơ: mỗi trace tự giữ mảng riêng */
  naiveCopy: string[];
}

const NAMES = ['mở chat', 'gõ tìm kiếm', 'cuộn feed', 'mở ảnh', 'like', 'gửi tin'];

export default function TraceRingBufferDemo() {
  const [capacity, setCapacity] = useState(30);
  const bufferRef = useRef(new IntervalTrackingBuffer<string>(capacity));
  const tracesRef = useRef<OpenTrace[]>([]);
  const [, force] = useState(0);
  const [running, setRunning] = useState(true);
  const counter = useRef(0);
  const nameIndex = useRef(0);
  const { lines, add } = useLog(30);

  const rerender = () => force((n) => n + 1);

  // Nguồn sự kiện: 20 sự kiện/giây (giống log TimeSlice trong lúc người dùng thao tác)
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const event = `ev#${++counter.current}`;
      const recorded = bufferRef.current.push(event);
      if (recorded) tracesRef.current.forEach((t) => t.naiveCopy.push(event));
      rerender();
    }, 50);
    return () => clearInterval(timer);
  }, [running]);

  const reset = (size: number) => {
    tracesRef.current = [];
    bufferRef.current = new IntervalTrackingBuffer<string>(size);
    setCapacity(size);
    add(`Buffer mới, sức chứa ${size}`, 'muted');
  };

  const openTrace = () => {
    const name = NAMES[nameIndex.current++ % NAMES.length];
    tracesRef.current.push({ name, window: bufferRef.current.open(), naiveCopy: [] });
    add(`Mở trace "${name}"`);
    rerender();
  };

  const closeTrace = (trace: OpenTrace) => {
    const entries = trace.window.close();
    tracesRef.current = tracesRef.current.filter((t) => t !== trace);
    const lost = trace.window.getOverflowSize();
    add(
      `Đóng "${trace.name}": giữ ${entries.length} sự kiện` +
        (lost > 0 ? `, MẤT ${lost} sự kiện đầu -> đánh dấu overflown` : ', đủ dữ liệu'),
      lost > 0 ? 'warn' : 'ok',
    );
    rerender();
  };

  const runScenario = async () => {
    reset(30);
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    setRunning(true);
    tracesRef.current.push({ name: 'A (dài)', window: bufferRef.current.open(), naiveCopy: [] });
    add('Mở trace "A (dài)"');
    await wait(800);
    tracesRef.current.push({ name: 'B (ngắn)', window: bufferRef.current.open(), naiveCopy: [] });
    add('Mở trace "B (ngắn)"');
    await wait(1000);
    const b = tracesRef.current.find((t) => t.name === 'B (ngắn)');
    if (b) closeTrace(b);
    await wait(1200);
    const a = tracesRef.current.find((t) => t.name === 'A (dài)');
    if (a) closeTrace(a);
  };

  const stats = bufferRef.current.stats;
  const naiveTotal = tracesRef.current.reduce((sum, t) => sum + t.naiveCopy.length, 0);

  return (
    <div className='page'>
      <h1>Ring buffer cho nhiều trace</h1>
      <p className='hint'>
        Sự kiện đổ vào 20 lần/giây. Mỗi trace mở một "cửa sổ ghi" trên CÙNG một buffer có sức chứa cố
        định. Khi đóng, trace biết mình có bị mất sự kiện đầu hay không. Không có trace nào mở thì
        buffer không ghi gì.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={openTrace}>
          Mở trace
        </button>
        <button onClick={runScenario}>Chạy kịch bản A dài + B ngắn</button>
        <button onClick={() => setRunning((r) => !r)}>{running ? 'Tạm dừng sự kiện' : 'Tiếp tục sự kiện'}</button>
        <label>
          Sức chứa{' '}
          <select value={capacity} onChange={(e) => reset(Number(e.target.value))} aria-label='Sức chứa buffer'>
            {[30, 100, 500].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className='stats'>
        <Stat label='Đang trong buffer' value={`${stats.size}/${capacity}`} />
        <Stat label='Đã đẩy vào (tổng)' value={stats.pushed} />
        <Stat label='Đã rời buffer' value={stats.dropped} />
        <Stat label='Mỗi trace một mảng' value={naiveTotal} />
      </div>
      <div className='card' data-testid='open-traces'>
        <h3>Trace đang mở</h3>
        {tracesRef.current.length === 0 && <p className='muted'>Chưa có trace nào: buffer không ghi sự kiện.</p>}
        {tracesRef.current.map((t) => {
          const lost = t.window.getOverflowSize();
          return (
            <div key={t.window.id} className='trb-row'>
              <b>{t.name}</b>
              <span className='muted'>mở từ #{t.window.startIndex + 1}</span>
              <span className={lost > 0 ? 'warn' : 'ok'}>{lost > 0 ? `đã mất ${lost}` : 'chưa mất gì'}</span>
              <button onClick={() => closeTrace(t)}>Đóng</button>
            </div>
          );
        })}
      </div>
      <Log lines={lines} />
    </div>
  );
}

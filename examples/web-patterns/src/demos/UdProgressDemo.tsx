import { useEffect, useRef, useState } from 'react';
import { createBatchSender, createProgressTracker, createRetryBudget, type ProgressRecord } from '../lib/udProgress';
import { Log, Stat, useLog } from './shared';
import './UdProgressDemo.css';

const INTERVAL = 15;
const OFFSET = 15;
const TICK_MS = 250;

/** Bản sao logic gốc của Udemy để so sánh (handleVideoProgress + onVideoProgress). */
function createUdemyTracker(onProgress: (r: { position: number; total: number }) => void, onComplete: () => void) {
  let lastPosition: number | undefined;
  let completed = false;
  return {
    update(currentTime: number, duration: number, type: string) {
      const position = Math.ceil(currentTime / INTERVAL);
      if (lastPosition === position || position <= 0) return;
      lastPosition = position;
      const time = type === 'ended' ? duration : Math.min(position * INTERVAL, duration);
      const record = { total: Math.floor(duration), position: Math.floor(time) };
      onProgress(record);
      if (record.position > 0 && record.position > record.total - OFFSET && !completed) {
        completed = true;
        onComplete();
      }
    },
    get completed() {
      return completed;
    },
  };
}

interface Counters {
  timeupdates: number;
  udEvents: number;
  newEvents: number;
  udDelivered: number;
  newDelivered: number;
  udLost: number;
}

export default function UdProgressDemo() {
  const [duration, setDuration] = useState(180);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [requireWatch, setRequireWatch] = useState(true);
  const [serverDown, setServerDown] = useState(false);
  const [counters, setCounters] = useState<Counters>({ timeupdates: 0, udEvents: 0, newEvents: 0, udDelivered: 0, newDelivered: 0, udLost: 0 });
  const [udDone, setUdDone] = useState(false);
  const [newDone, setNewDone] = useState(false);
  const [watched, setWatched] = useState(0);
  const udLog = useLog(40);
  const newLog = useLog(40);
  const retryLog = useLog(20);

  const bump = (patch: Partial<Record<keyof Counters, number>>) =>
    setCounters((c) => {
      const next = { ...c };
      for (const [k, v] of Object.entries(patch)) next[k as keyof Counters] += v as number;
      return next;
    });

  const serverDownRef = useRef(serverDown);
  serverDownRef.current = serverDown;

  // ---- hai bộ theo dõi tiến độ, dựng lại khi đổi video hoặc đổi chế độ ----
  const state = useRef<{
    ud: ReturnType<typeof createUdemyTracker>;
    udQueue: { position: number; total: number }[];
    tracker: ReturnType<typeof createProgressTracker>;
    sender: ReturnType<typeof createBatchSender<ProgressRecord>>;
  } | null>(null);

  function rebuild() {
    const udQueue: { position: number; total: number }[] = [];
    const ud = createUdemyTracker(
      (r) => {
        bump({ udEvents: 1 });
        // giống onVideoProgress: đủ 5 thì gửi (rồi mới push bản ghi hiện tại)
        if (udQueue.length >= 5) {
          const batch = udQueue.splice(0);
          if (serverDownRef.current) {
            bump({ udLost: batch.length });
            udLog.add(`✘ POST ${batch.length} bản ghi lỗi → mất luôn (đã xoá khỏi hàng đợi)`, 'err');
          } else {
            bump({ udDelivered: batch.length });
            udLog.add(`↑ POST ${batch.length} bản ghi`, 'ok');
          }
        }
        udQueue.push(r);
        udLog.add(`progress position=${r.position}/${r.total}`);
      },
      () => {
        setUdDone(true);
        udLog.add('✔ đánh dấu học xong', 'ok');
      },
    );
    const sender = createBatchSender<ProgressRecord>({
      size: 5,
      async send(items) {
        if (serverDownRef.current) {
          newLog.add(`✘ POST ${items.length} bản ghi lỗi → giữ lại, lần sau gửi tiếp`, 'warn');
          throw new Error('503');
        }
        bump({ newDelivered: items.length });
        newLog.add(`↑ POST ${items.length} bản ghi`, 'ok');
      },
      beacon(items) {
        bump({ newDelivered: items.length });
        newLog.add(`↑ sendBeacon ${items.length} bản ghi lúc đóng tab`, 'ok');
        return true;
      },
    });
    const tracker = createProgressTracker({
      interval: INTERVAL,
      completionOffset: OFFSET,
      minWatchedRatio: requireWatch ? 0.8 : 0,
      onProgress(r) {
        bump({ newEvents: 1 });
        newLog.add(`progress position=${r.position}/${r.total} đã xem ${r.watched}s${r.type === 'ended' ? ' (ended)' : ''}`);
        sender.push(r);
      },
      onComplete(r) {
        setNewDone(true);
        newLog.add(`✔ đánh dấu học xong (đã xem ${r.watched}s / ${r.total}s)`, 'ok');
      },
    });
    state.current = { ud, udQueue, tracker, sender };
  }

  function resetAll(nextDuration = duration) {
    setDuration(nextDuration);
    setTime(0);
    setPlaying(false);
    setUdDone(false);
    setNewDone(false);
    setWatched(0);
    setCounters({ timeupdates: 0, udEvents: 0, newEvents: 0, udDelivered: 0, newDelivered: 0, udLost: 0 });
    udLog.clear();
    newLog.clear();
    rebuild();
  }

  if (!state.current) rebuild();

  useEffect(() => {
    rebuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requireWatch]);

  const timeRef = useRef(time);
  timeRef.current = time;

  function emit(t: number, type: 'timeupdate' | 'ended' | 'seeked') {
    const s = state.current!;
    s.ud.update(t, duration, type);
    s.tracker.update(t, duration, type);
    setWatched(s.tracker.watched);
    bump({ timeupdates: 1 });
  }

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = Math.min(duration, timeRef.current + (TICK_MS / 1000) * speed);
      setTime(next);
      if (next >= duration) {
        emit(next, 'ended');
        setPlaying(false);
      } else {
        emit(next, 'timeupdate');
      }
    }, TICK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, duration]);

  function seek(t: number) {
    setTime(t);
    emit(t, 'seeked');
  }

  function closeTab() {
    const s = state.current!;
    const lost = s.udQueue.length;
    s.udQueue.length = 0;
    bump({ udLost: lost });
    udLog.add(`✘ beforeunload gọi axios.post ${lost} bản ghi → request bị huỷ cùng trang`, 'err');
    s.sender.flushWithBeacon();
    setPlaying(false);
  }

  // ---- ngân sách thử lại ----
  const virtualNow = useRef(0);
  const budget = useRef(createRetryBudget({ limit: 5, healthyMs: 60_000, now: () => virtualNow.current })).current;
  const udErrors = useRef(0);
  function networkBlip(gapMinutes: number) {
    virtualNow.current += gapMinutes * 60_000;
    udErrors.current += 1;
    const udDelay = udErrors.current <= 5 ? `${500 * udErrors.current ** 2}ms` : 'không thử lại → màn hình lỗi';
    const newDelay = budget.onError();
    retryLog.add(
      `+${gapMinutes} phút, mạng chớp: Udemy lỗi #${udErrors.current} → ${udDelay} | viết lại lỗi #${budget.failures} → ${
        newDelay === null ? 'hết quyền' : `${newDelay}ms`
      }`,
      udErrors.current > 5 ? 'err' : undefined,
    );
  }

  const pct = (time / duration) * 100;

  return (
    <div className='page ud-progress'>
      <h1>Tiến độ xem theo bucket 15 giây</h1>
      <p className='hint'>
        Video giả lập (không có file thật). Mỗi 250ms bắn một <code>timeupdate</code>. Cột trái chạy đúng logic gốc của
        Udemy, cột phải là bản viết lại.
      </p>

      <div className='toolbar'>
        <label>
          Thời lượng:{' '}
          <select value={duration} data-testid='duration' onChange={(e) => resetAll(Number(e.target.value))}>
            <option value={10}>10 giây</option>
            <option value={180}>3 phút</option>
            <option value={600}>10 phút</option>
          </select>
        </label>
        <button className='primary' data-testid='play' onClick={() => setPlaying((p) => !p)}>
          {playing ? '❚❚ Dừng' : '▶ Phát'}
        </button>
        <label>
          Tốc độ:{' '}
          <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
            {[1, 4, 16].map((s) => (
              <option key={s} value={s}>
                {s}× (mô phỏng)
              </option>
            ))}
          </select>
        </label>
        <button data-testid='seek-end' onClick={() => seek(Math.max(0, duration - 5))}>
          Tua tới gần cuối
        </button>
        <button onClick={() => resetAll()}>Làm lại</button>
      </div>
      <input
        type='range'
        className='ud-progress-seek'
        min={0}
        max={duration}
        step={1}
        value={Math.floor(time)}
        onChange={(e) => seek(Number(e.target.value))}
        aria-label='Vị trí video'
      />
      <div className='ud-progress-bar'>
        <div style={{ width: `${pct}%` }} />
        {Array.from({ length: Math.floor(duration / INTERVAL) }, (_, i) => (
          <span key={i} style={{ left: `${(((i + 1) * INTERVAL) / duration) * 100}%` }} />
        ))}
      </div>
      <div className='toolbar'>
        <span>
          {time.toFixed(1)}s / {duration}s · đã xem thật <output data-testid='watched'>{Math.floor(watched)}</output>s
        </span>
        <label>
          <input type='checkbox' checked={requireWatch} onChange={(e) => setRequireWatch(e.target.checked)} /> Bản viết lại
          đòi xem ≥ 80% mới tính xong
        </label>
        <label>
          <input type='checkbox' checked={serverDown} data-testid='server-down' onChange={(e) => setServerDown(e.target.checked)} />{' '}
          Server progress lỗi 503
        </label>
        <button data-testid='close-tab' onClick={closeTab}>
          Đóng tab
        </button>
      </div>

      <div className='stats'>
        <Stat label='timeupdate' value={<output data-testid='timeupdates'>{counters.timeupdates}</output>} />
        <Stat label='progress (Udemy / viết lại)' value={<output data-testid='events'>{`${counters.udEvents} / ${counters.newEvents}`}</output>} />
        <Stat label='bản ghi tới server' value={<output data-testid='delivered'>{`${counters.udDelivered} / ${counters.newDelivered}`}</output>} />
        <Stat label='Udemy làm mất' value={<output data-testid='ud-lost'>{counters.udLost}</output>} />
        <Stat
          label='học xong? (Udemy / viết lại)'
          value={<output data-testid='done'>{`${udDone ? '✔' : '–'} / ${newDone ? '✔' : '–'}`}</output>}
        />
      </div>

      <div className='ud-progress-cols'>
        <div className='card'>
          <h2>Kiểu Udemy</h2>
          <Log lines={udLog.lines} />
        </div>
        <div className='card'>
          <h2>Bản viết lại</h2>
          <Log lines={newLog.lines} />
        </div>
      </div>

      <div className='card'>
        <h2>Thử lại khi mạng chớp: 500·n² ms</h2>
        <div className='toolbar'>
          <button data-testid='blip-20' onClick={() => networkBlip(20)}>
            Mạng chớp (sau 20 phút xem ổn)
          </button>
          <button data-testid='blip-0' onClick={() => networkBlip(0)}>
            Mạng chớp liên tục
          </button>
        </div>
        <Log lines={retryLog.lines} />
      </div>
    </div>
  );
}

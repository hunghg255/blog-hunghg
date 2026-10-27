import { useEffect, useRef, useState } from 'react';
import { createBatchedMap, createSnapshotSync } from '../lib/realtimeSnapshot';
import { Log, Stat, useLog } from './shared';
import './RealtimePublishDemo.css';

const TOTAL = 50;
const TICK_MS = 60; // server xong một mục mỗi 60 ms
const JOIN_AT = 10; // client mở trang khi server đã xong 10 mục
const READ_DELAY_MS = 60; // request REST tới server sau 60 ms
const WATCHDOG_MS = 2000; // bản gốc dùng 30 000 ms, demo rút ngắn

type Mode = 'naive' | 'buffer';

interface PublishState {
  seq: number;
  done: number[];
}

interface DoneEvent {
  seq: number;
  id: number;
}

/** idempotent: mục đã có thì không thêm lần nữa, seq giữ giá trị lớn nhất */
const applyDone = (state: PublishState, event: DoneEvent): PublishState => ({
  seq: Math.max(state.seq, event.seq),
  done: state.done.includes(event.id) ? state.done : [...state.done, event.id],
});

export default function RealtimePublishDemo() {
  const { lines, add, clear } = useLog(60);
  const [mode, setMode] = useState<Mode>('buffer');
  const [snapshotMs, setSnapshotMs] = useState(900);
  const [dropPushAt, setDropPushAt] = useState(false);
  const [watchdog, setWatchdog] = useState(true);
  const [restFailsOnce, setRestFailsOnce] = useState(false);
  const [serverDone, setServerDone] = useState(0);
  const [clientDone, setClientDone] = useState<number[]>([]);
  const [buffered, setBuffered] = useState(0);
  const [stalls, setStalls] = useState(0);
  const [deleteDispatches, setDeleteDispatches] = useState<string>('—');
  const stopRef = useRef<() => void>(() => {});

  useEffect(() => () => stopRef.current(), []);

  const run = () => {
    stopRef.current();
    clear();
    setStalls(0);
    setBuffered(0);
    setClientDone([]);
    setDeleteDispatches('—');

    // ---------- server giả ----------
    let seq = 0;
    const done: number[] = [];
    let listener: ((e: DoneEvent) => void) | null = null;
    let pushAlive = true;
    let restCalls = 0;
    const completeOne = () => {
      const id = done.length + 1;
      done.push(id);
      seq++;
      setServerDone(done.length);
      if (dropPushAt && id === 31 && pushAlive) {
        pushAlive = false;
        add('Server: kênh push bị kẹt từ mục #31 (server vẫn xử lý tiếp)', 'warn');
      }
      if (pushAlive) {
        const event = { seq, id };
        // push tới client sau 20–80 ms, có thể đảo thứ tự nhẹ
        setTimeout(() => listener?.(event), 20 + Math.random() * 60);
      }
    };
    for (let i = 0; i < JOIN_AT; i++) completeOne();
    const timer = setInterval(() => {
      if (done.length >= TOTAL) {
        clearInterval(timer);
        return;
      }
      completeOne();
    }, TICK_MS);

    const fetchSnapshot = () =>
      new Promise<PublishState>((resolve, reject) => {
        restCalls++;
        const failThis = restFailsOnce && restCalls === 1;
        let snapshot: PublishState = { seq: 0, done: [] };
        // server đọc trạng thái ngay khi request tới…
        setTimeout(() => {
          snapshot = { seq, done: [...done] };
        }, READ_DELAY_MS);
        // …nhưng response về chậm hơn nhiều
        setTimeout(() => {
          if (failThis) reject(new Error('HTTP 503'));
          else {
            add(`REST: snapshot ${snapshot.done.length} mục (đọc ở seq #${snapshot.seq}) về sau ${snapshotMs} ms`);
            resolve(snapshot);
          }
        }, snapshotMs);
      });

    // ---------- client ----------
    let cancelled = false;
    if (mode === 'naive') {
      let state: PublishState = { seq: 0, done: [] };
      listener = (e) => {
        state = applyDone(state, e);
        setClientDone(state.done);
      };
      fetchSnapshot()
        .then((s) => {
          if (cancelled) return;
          add('Ngây thơ: ghi đè state bằng snapshot, các event đã áp trước đó mất', 'err');
          state = s;
          setClientDone(s.done);
        })
        .catch((e: Error) => add(`REST lỗi: ${e.message}`, 'err'));
    } else {
      const sync = createSnapshotSync<PublishState, DoneEvent>({
        fetchSnapshot,
        apply: applyDone,
        onState: (s) => {
          setClientDone(s.done);
          // đăng xong thì tắt watchdog (bản gốc: clearTimeout khi PUBLISH_COMPLETED)
          if (s.done.length === TOTAL) sync.stop();
        },
        watchdogMs: watchdog ? WATCHDOG_MS : 0,
        onStall: () => setStalls((n) => n + 1),
        onLog: (m) =>
          add(m, m.startsWith('Không có push') ? 'warn' : m.startsWith('Lấy snapshot lỗi') ? 'err' : m.startsWith('Bỏ event') ? 'muted' : undefined),
      });
      listener = (e) => {
        sync.receive(e);
        if (sync.isBuffering()) setBuffered((n) => n + 1);
      };
      void sync.start();
      stopRef.current = () => {
        cancelled = true;
        sync.stop();
        clearInterval(timer);
        listener = null;
      };
    }
    if (mode === 'naive') {
      stopRef.current = () => {
        cancelled = true;
        clearInterval(timer);
        listener = null;
      };
    }
    add(`Client mở trang khi server đã đăng ${JOIN_AT}/${TOTAL} mục: subscribe push + gọi REST cùng lúc`);
  };

  // gom event "đã xoá" bằng debounce 100 ms (bản gốc dùng cho FRAGMENT_DELETED)
  const burstDeletes = (batched: boolean) => {
    let dispatches = 0;
    const flushOne = (n: number) => {
      dispatches++;
      add(`dispatch "đã xoá" (${n} mục)`, 'muted');
    };
    const batch = createBatchedMap<number, { id: number }>(100, (items) => {
      flushOne(items.size);
      setDeleteDispatches(`12 event → ${dispatches} lần dispatch`);
    });
    for (let i = 1; i <= 12; i++) {
      setTimeout(() => {
        if (batched) batch.add(i, { id: i });
        else {
          flushOne(1);
          setDeleteDispatches(`12 event → ${dispatches} lần dispatch`);
        }
      }, i * 8);
    }
  };

  const lost = Math.max(0, serverDone - clientDone.length);

  return (
    <div className='page rp'>
      <h1>Tiến độ đăng realtime: snapshot + push</h1>
      <p className='hint'>
        Server đang đăng {TOTAL} quảng cáo, mỗi mục xong lại đẩy một event qua kênh push. Client mở trang giữa chừng nên
        phải lấy trạng thái hiện tại qua REST. Event nào tới trước khi REST trả về? Thử "Ngây thơ" rồi "Giữ event chờ
        snapshot".
      </p>
      <div className='toolbar'>
        <label>
          Cách làm{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value='naive'>Ngây thơ: áp event ngay</option>
            <option value='buffer'>Giữ event chờ snapshot (Facebook)</option>
          </select>
        </label>
        <label>
          REST trả về sau{' '}
          <select value={snapshotMs} onChange={(e) => setSnapshotMs(Number(e.target.value))}>
            <option value={150}>150 ms</option>
            <option value={900}>900 ms</option>
            <option value={1800}>1800 ms</option>
          </select>
        </label>
        <button className='primary' onClick={run}>
          ▶ Mở trang lúc đang đăng
        </button>
      </div>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={dropPushAt} onChange={(e) => setDropPushAt(e.target.checked)} /> push kẹt từ mục #31
        </label>
        <label>
          <input type='checkbox' checked={watchdog} onChange={(e) => setWatchdog(e.target.checked)} /> watchdog {WATCHDOG_MS / 1000}s
        </label>
        <label>
          <input type='checkbox' checked={restFailsOnce} onChange={(e) => setRestFailsOnce(e.target.checked)} /> REST lỗi lần đầu
        </label>
      </div>

      <div className='rp-bars'>
        <div>
          <span>Server</span>
          <div className='rp-bar'>
            <i style={{ width: `${(serverDone / TOTAL) * 100}%` }} />
          </div>
          <b>
            {serverDone}/{TOTAL}
          </b>
        </div>
        <div>
          <span>Client</span>
          <div className='rp-bar rp-client'>
            {Array.from({ length: TOTAL }, (_, i) => (
              <em key={i} data-on={clientDone.includes(i + 1) || undefined} data-lost={(!clientDone.includes(i + 1) && i + 1 <= serverDone) || undefined} />
            ))}
          </div>
          <b>
            {clientDone.length}/{TOTAL}
          </b>
        </div>
      </div>

      <div className='stats'>
        <Stat label='mục client chưa biết' value={<bdi className={lost && serverDone === TOTAL ? 'err' : undefined}>{lost}</bdi>} />
        <Stat label='event giữ lại chờ snapshot' value={<bdi>{buffered}</bdi>} />
        <Stat label='lần watchdog kích hoạt' value={<bdi>{stalls}</bdi>} />
        <Stat label='server' value={<bdi>{serverDone < TOTAL ? 'đang đăng' : 'đã đăng xong'}</bdi>} />
      </div>

      <div className='toolbar rp-del'>
        <button onClick={() => burstDeletes(false)}>Xoá 12 mục: dispatch từng event</button>
        <button onClick={() => burstDeletes(true)}>Xoá 12 mục: gom 100 ms</button>
        <span className='muted'>{deleteDispatches}</span>
      </div>
      <Log lines={lines} />
    </div>
  );
}

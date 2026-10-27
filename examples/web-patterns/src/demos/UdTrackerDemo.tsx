import { useEffect, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import { createTracker, type EventStatus, type TrackEvent, type Transport } from '../lib/udTracker';
import { createUdemyStyleTracker } from './UdTrackerUdemyStyle';
import './UdTrackerDemo.css';

type Mode = 'ok' | 'partial' | 'broken207' | 'flaky' | 'offline';

const MODES: { id: Mode; label: string }[] = [
  { id: 'ok', label: '200 OK' },
  { id: 'partial', label: '207: sự kiện thứ 2 bị từ chối' },
  { id: 'broken207', label: '207 nhưng body hỏng' },
  { id: 'flaky', label: '503 hai lần rồi OK' },
  { id: 'offline', label: 'Mất mạng' },
];

interface ServerStats {
  requests: number;
  beacons: number;
  received: number;
  duplicates: number;
}

/** Server giả lập: đếm sự kiện nhận được, phát hiện trùng theo id. */
function createFakeServer(getMode: () => Mode, onChange: () => void) {
  const seen = new Set<string>();
  const stats: ServerStats = { requests: 0, beacons: 0, received: 0, duplicates: 0 };
  let flakyLeft = 2;
  const record = (body: string) => {
    for (const e of JSON.parse(body) as TrackEvent[]) {
      if (seen.has(e.id)) stats.duplicates++;
      else stats.received++;
      seen.add(e.id);
    }
  };
  const transport: Transport = {
    async post(_url, body) {
      stats.requests++;
      onChange();
      await new Promise((r) => setTimeout(r, 700));
      const mode = getMode();
      if (mode === 'offline') throw new TypeError('Failed to fetch');
      if (mode === 'flaky' && flakyLeft > 0) {
        flakyLeft--;
        return { status: 503 };
      }
      record(body);
      onChange();
      if (mode === 'partial') return { status: 207, body: { failedEvents: [{ idx: 1, reason: 'schema: thiếu courseId' }] } };
      if (mode === 'broken207') return { status: 207, body: { error: 'collector timeout' } };
      return { status: 200 };
    },
    beacon(_url, body) {
      stats.beacons++;
      record(body);
      onChange();
      return true;
    },
  };
  return {
    transport,
    stats,
    resetFlaky() {
      flakyLeft = 2;
    },
  };
}

type Counts = Record<EventStatus, number>;
const zero = (): Counts => ({ sent: 0, beacon: 0, rejected: 0, failed: 0 });

function useSide(kind: 'udemy' | 'ours', modeRef: React.MutableRefObject<Mode>, log: (t: string, tone?: 'ok' | 'warn' | 'err') => void) {
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const counts = useRef<Counts>(zero());
  const serverRef = useRef(createFakeServer(() => modeRef.current, rerender));
  const trackerRef = useRef<ReturnType<typeof createTracker> | ReturnType<typeof createUdemyStyleTracker> | null>(null);

  useEffect(() => {
    const onStatus = (e: TrackEvent, s: EventStatus, reason?: string) => {
      counts.current[s]++;
      if (s !== 'sent') log(`${kind === 'udemy' ? 'Udemy' : 'Viết lại'}: ${e.type} → ${s}${reason ? ` (${reason})` : ''}`, s === 'beacon' ? 'ok' : 'warn');
      rerender();
    };
    const common = { endpoint: '/ecl', transport: serverRef.current.transport, onStatus };
    trackerRef.current =
      kind === 'udemy'
        ? createUdemyStyleTracker({ ...common, flushInterval: 3000, retryGap: 800 })
        : createTracker({ ...common, flushInterval: 3000, retryGap: 800 });
    const tick = setInterval(rerender, 300);
    return () => {
      trackerRef.current?.destroy();
      clearInterval(tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { tracker: trackerRef, server: serverRef.current, counts: counts.current };
}

export default function UdTrackerDemo() {
  const [mode, setMode] = useState<Mode>('ok');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const { lines, add } = useLog(40);
  const udemy = useSide('udemy', modeRef, add);
  const ours = useSide('ours', modeRef, add);
  const n = useRef(0);

  const fire = (count: number) => {
    for (let i = 0; i < count; i++) {
      const type = ['page_view', 'lecture_start', 'click', 'search', 'video_progress'][n.current++ % 5];
      udemy.tracker.current?.track(type, { n: n.current });
      ours.tracker.current?.track(type, { n: n.current });
    }
  };

  return (
    <div className='page ud-tracker'>
      <h1>Pipeline tracking: batch, beacon, 207</h1>
      <p className='hint'>
        Hai tracker nhận cùng sự kiện, gửi lên hai server giả (trễ 700ms, lô mỗi 3 giây). Đổi kiểu phản hồi của server rồi
        bấm gửi sự kiện. "Ẩn tab" mô phỏng <code>visibilitychange → hidden</code> ngay lúc một lô đang bay.
      </p>
      <div className='toolbar' role='group' aria-label='Server trả về'>
        {MODES.map((m) => (
          <button
            key={m.id}
            data-mode={m.id}
            className={mode === m.id ? 'primary' : ''}
            onClick={() => {
              setMode(m.id);
              udemy.server.resetFlaky();
              ours.server.resetFlaky();
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <button onClick={() => fire(5)}>+5 sự kiện</button>
        <button
          onClick={() => {
            udemy.tracker.current?.flush();
            ours.tracker.current?.flush();
          }}
        >
          Gửi ngay
        </button>
        <button
          onClick={() => {
            fire(3);
            udemy.tracker.current?.flush();
            ours.tracker.current?.flush();
            setTimeout(() => {
              fire(2);
              udemy.tracker.current?.onHidden();
              ours.tracker.current?.onHidden();
              add('Tab bị ẩn trong lúc lô 3 sự kiện đang bay', 'warn');
            }, 200);
          }}
        >
          Ẩn tab khi đang gửi
        </button>
      </div>
      <div className='split'>
        <Side title='Kiểu Udemy (mô phỏng)' testId='udemy' side={udemy} stuck={(udemy.tracker.current as { isStuck?: boolean })?.isStuck} />
        <Side title='Bản viết lại' testId='ours' side={ours} />
      </div>
      <Log lines={lines} />
    </div>
  );
}

function Side({
  title,
  testId,
  side,
  stuck,
}: {
  title: string;
  testId: string;
  side: ReturnType<typeof useSide>;
  stuck?: boolean;
}) {
  const t = side.tracker.current;
  const s = side.server.stats;
  return (
    <div className='card' data-testid={testId}>
      <h2>{title}</h2>
      <div className='stats'>
        <Stat label='trong hàng đợi' value={<bdi data-testid={`${testId}-queue`}>{t?.queueSize ?? 0}</bdi>} />
        <Stat label='server nhận' value={<bdi data-testid={`${testId}-received`}>{s.received}</bdi>} />
        <Stat label='bị nhận trùng' value={<bdi data-testid={`${testId}-dup`}>{s.duplicates}</bdi>} />
        <Stat label='request / beacon' value={`${s.requests} / ${s.beacons}`} />
      </div>
      <p className='muted ud-tracker-counts' data-testid={`${testId}-counts`}>
        sent {side.counts.sent} · beacon {side.counts.beacon} · rejected {side.counts.rejected} · failed {side.counts.failed}
      </p>
      {stuck !== undefined && (
        <p className={stuck ? 'err' : 'muted'} data-testid={`${testId}-lock`}>
          Khoá gửi: {stuck ? 'đang khoá' : 'mở'}
        </p>
      )}
    </div>
  );
}

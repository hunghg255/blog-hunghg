import { useRef, useState } from 'react';
import {
  runAsyncCheckout,
  type CheckoutApi,
  type CheckoutEvent,
  type CheckoutOutcome,
  type StatusResponse,
} from '../lib/asyncCheckout';
import './AsyncCheckoutDemo.css';

/** Cấu hình "server" giả cho từng kịch bản. Thời gian trong demo được thu nhỏ. */
interface ServerConfig {
  /** charge trả kết quả sau bao lâu */
  chargeLatency: number;
  /** null = charge trả success ngay; số = giao dịch xong sau bấy nhiêu ms kể từ lúc charge */
  processingMs: number | null;
  /** subscription có đẩy sự kiện không (false = sự kiện bị rơi) */
  pushEvents: boolean;
  /** queryStatus mất bao lâu */
  queryLatency: number;
}

interface Scenario {
  id: string;
  label: string;
  server: ServerConfig;
  subscribeAfterCharge?: boolean;
  pollMode?: 'chain' | 'interval';
}

const SCENARIOS: Scenario[] = [
  {
    id: 'instant',
    label: 'Charge trả success ngay',
    server: { chargeLatency: 300, processingMs: null, pushEvents: true, queryLatency: 150 },
  },
  {
    id: 'sub',
    label: 'Xử lý 1,5 s, subscription báo về',
    server: { chargeLatency: 300, processingMs: 1500, pushEvents: true, queryLatency: 150 },
  },
  {
    id: 'lost',
    label: 'Subscription rơi sự kiện → polling cứu',
    server: { chargeLatency: 300, processingMs: 1500, pushEvents: false, queryLatency: 150 },
  },
  {
    id: 'hang',
    label: 'Server treo → timeout',
    server: { chargeLatency: 300, processingMs: 60_000, pushEvents: true, queryLatency: 150 },
  },
  {
    id: 'late-sub',
    label: 'Sai: subscribe SAU charge',
    server: { chargeLatency: 600, processingMs: 400, pushEvents: true, queryLatency: 150 },
    subscribeAfterCharge: true,
  },
  {
    id: 'interval',
    label: 'Poll bằng setInterval, query chậm',
    server: { chargeLatency: 300, processingMs: 3800, pushEvents: false, queryLatency: 1300 },
    pollMode: 'interval',
  },
];

const POLL = { pollTimeMs: 800, pollTimeRetryMs: 500, timeoutMs: 5000 };
const LANES = ['session', 'charge', 'subscription', 'polling', 'timeout'] as const;

function createFakeServer(
  cfg: ServerConfig,
  stats: { inFlight: number; maxInFlight: number },
): CheckoutApi {
  let doneAt = Infinity;
  const listeners = new Set<(u: StatusResponse) => void>();
  const statusNow = (): StatusResponse =>
    performance.now() >= doneAt ? { status: 'success' } : { status: 'in_progress' };
  return {
    createSession: () =>
      new Promise((r) => setTimeout(() => r(`ps_${Math.random().toString(36).slice(2, 7)}`), 150)),
    charge() {
      if (cfg.processingMs === null) {
        return new Promise((r) => setTimeout(() => r({ status: 'success' }), cfg.chargeLatency));
      }
      doneAt = performance.now() + cfg.processingMs;
      // giao dịch xong thì server đẩy sự kiện cho ai đang subscribe LÚC ĐÓ
      setTimeout(() => {
        if (cfg.pushEvents) listeners.forEach((l) => l({ status: 'success' }));
      }, cfg.processingMs);
      return new Promise((r) => setTimeout(() => r({ status: 'in_progress' }), cfg.chargeLatency));
    },
    queryStatus() {
      stats.inFlight++;
      stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
      return new Promise((r) =>
        setTimeout(() => {
          stats.inFlight--;
          r(statusNow());
        }, cfg.queryLatency),
      );
    },
    subscribe(_id, onUpdate) {
      listeners.add(onUpdate);
      return () => void listeners.delete(onUpdate);
    },
  };
}

export default function AsyncCheckoutDemo() {
  const [events, setEvents] = useState<CheckoutEvent[]>([]);
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [maxInFlight, setMaxInFlight] = useState(0);
  const cancelRef = useRef<() => void>(() => {});

  async function run(s: Scenario) {
    cancelRef.current();
    setEvents([]);
    setOutcome(null);
    setRunning(s.id);
    const stats = { inFlight: 0, maxInFlight: 0 };
    const api = createFakeServer(s.server, stats);
    const { promise, cancel } = runAsyncCheckout(api, null, {
      ...POLL,
      pollMode: s.pollMode,
      subscribeAfterCharge: s.subscribeAfterCharge,
      onEvent: (e) => setEvents((prev) => [...prev, e]),
    });
    cancelRef.current = cancel;
    const result = await promise;
    setOutcome(result);
    setMaxInFlight(stats.maxInFlight);
    setRunning(null);
  }

  const total = Math.max(1000, ...events.map((e) => e.at)) * 1.08;

  return (
    <div className='page checkout-demo'>
      <h1>Thanh toán bất đồng bộ</h1>
      <p className='hint'>
        Kết quả có thể đến từ charge, subscription, polling hoặc timeout. Cái nào đến trước thì
        thắng, phần còn lại bị huỷ. Thời gian được thu nhỏ: chờ {POLL.pollTimeMs} ms mới poll, poll
        mỗi {POLL.pollTimeRetryMs} ms, timeout {POLL.timeoutMs} ms.
      </p>
      <div className='toolbar ck-scenarios'>
        {SCENARIOS.map((s) => (
          <button key={s.id} onClick={() => run(s)} className={running === s.id ? 'primary' : ''}>
            {s.label}
          </button>
        ))}
      </div>
      <div className='ck-timeline' aria-label='Dòng thời gian'>
        {LANES.map((lane) => (
          <div key={lane} className='ck-lane'>
            <span className='ck-lane-name'>{lane}</span>
            <div className='ck-track'>
              {events
                .filter((e) => e.source === lane)
                .map((e, i) => (
                  <span
                    key={i}
                    className={`ck-dot ${e.text.startsWith('KẾT THÚC') ? 'ck-win' : ''}`}
                    style={{ left: `${(e.at / total) * 100}%` }}
                    title={`${e.at} ms: ${e.text}`}
                  />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className='stats'>
        <div className='stat'>
          <b data-testid='winner'>
            {outcome ? `${outcome.status} · ${outcome.source}` : running ? '…' : '—'}
          </b>
          <span>kết quả · nguồn thắng</span>
        </div>
        <div className='stat'>
          <b>{outcome ? `${events.at(-1)?.at ?? 0} ms` : '—'}</b>
          <span>thời gian tới kết quả</span>
        </div>
        <div className='stat'>
          <b data-testid='overlap'>{outcome ? maxInFlight : '—'}</b>
          <span>query chồng nhau tối đa</span>
        </div>
      </div>
      <ol className='log ck-events'>
        {events.map((e, i) => (
          <li key={i} className={e.text.startsWith('KẾT THÚC') ? 'ok' : ''}>
            {String(e.at).padStart(5, ' ')} ms · {e.source}: {e.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

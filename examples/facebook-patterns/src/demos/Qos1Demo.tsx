import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createDedupe,
  createQos1Channel,
  createWatchReporter,
  totalWatchedMs,
  type OutPacket,
  type PublishState,
  type WatchUpdate,
} from '../lib/qos1Channel';
import { Log, Stat, useLog } from './shared';
import './Qos1Demo.css';

const TIMEOUT = 60_000;

export default function Qos1Demo() {
  const [tab, setTab] = useState<'qos' | 'watch'>('qos');
  return (
    <div className='page q1-demo'>
      <h1>MQTT QoS1: giữ publish chờ ack, gửi lại khi kết nối lại</h1>
      <div className='q1-tabs' role='tablist'>
        <button role='tab' aria-selected={tab === 'qos'} className={tab === 'qos' ? 'active' : ''} onClick={() => setTab('qos')}>
          1. Hàng chờ ack
        </button>
        <button role='tab' aria-selected={tab === 'watch'} className={tab === 'watch' ? 'active' : ''} onClick={() => setTab('watch')} data-testid='tab-watch'>
          2. Heartbeat trạng thái tuyệt đối
        </button>
      </div>
      {tab === 'qos' ? <QosPanel /> : <WatchPanel />}
    </div>
  );
}

// ───────────────────────── đồng hồ giả chạy theo thời gian thật, tua được ─────────────────────────

interface FakeTimer {
  at: number;
  fn: () => void;
  live: boolean;
}
function useFakeClock(onTick: () => void) {
  const now = useRef(0);
  const timers = useRef<FakeTimer[]>([]);
  const advance = (ms: number) => {
    const end = now.current + ms;
    for (;;) {
      const next = timers.current.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!next) break;
      now.current = Math.max(now.current, next.at);
      next.live = false;
      next.fn();
    }
    now.current = end;
    timers.current = timers.current.filter((t) => t.live);
    onTick();
  };
  const api = useRef({
    now: () => now.current,
    setTimer: (fn: () => void, ms: number) => {
      const t = { at: now.current + ms, fn, live: true };
      timers.current.push(t);
      return t;
    },
    clearTimer: (h: unknown) => void ((h as FakeTimer).live = false),
  }).current;
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  useEffect(() => {
    const id = setInterval(() => advanceRef.current(200), 200);
    return () => clearInterval(id);
  }, []);
  return { ...api, advance };
}

// ───────────────────────── Tab 1 ─────────────────────────

interface Row {
  token: string;
  text: string;
  qos: 0 | 1;
  state: PublishState;
  attempts: number;
  sentAt: number;
}

function QosPanel() {
  const { lines, add } = useLog(60);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const clock = useFakeClock(refresh);
  const rows = useRef(new Map<string, Row>());
  const [ackLost, setAckLost] = useState(false);
  const [dedupeOn, setDedupeOn] = useState(true);
  const ackLostRef = useRef(ackLost);
  ackLostRef.current = ackLost;
  const dedupeOnRef = useRef(dedupeOn);
  dedupeOnRef.current = dedupeOn;
  const server = useRef({ received: 0, shown: [] as string[], dropped: 0 });
  const dedupe = useMemo(() => createDedupe(), []);
  const seq = useRef(1);

  const channel = useMemo(() => {
    const ch = createQos1Channel({
      timeoutMs: TIMEOUT,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      newToken: () => 't' + (seq.current++).toString().padStart(2, '0'),
      transport: {
        send(p: OutPacket) {
          // gói tới server sau 300ms; ack về sau 300ms nữa (trừ khi bật "mất ack")
          clock.setTimer(() => {
            server.current.received++;
            const fresh = dedupe.accept(p.token);
            if (fresh || !dedupeOnRef.current) server.current.shown.push(`${p.payload}${fresh ? '' : ' (trùng)'}`);
            else server.current.dropped++;
            if (p.qos === 1) {
              if (ackLostRef.current) add(`server nhận ${p.token} nhưng ack bị mất trên đường về`, 'warn');
              else clock.setTimer(() => ch.ack(p.token), 300);
            }
          }, 300);
          return true;
        },
      },
      onState: (token, state, p) => {
        const row = rows.current.get(token) ?? { token, text: p.payload, qos: p.qos, state, attempts: 1, sentAt: clock.now() };
        row.state = state;
        row.attempts = p.attempt;
        rows.current.set(token, row);
        const label = p.attempt > 1 && state === 'sent' ? `phát lại ${token} (lần ${p.attempt})` : `${token} → ${state}`;
        add(label, state === 'acked' ? 'ok' : state === 'timeout' || state === 'failed' ? 'err' : state === 'queued' ? 'muted' : undefined);
        refresh();
      },
    });
    ch.setConnected(true);
    return ch;
  }, []);

  const send = (qos: 0 | 1) => {
    const { done } = channel.publish('/send_message', `tin ${rows.current.size + 1}`, qos);
    done.catch(() => {}); // lỗi đã hiện qua onState
  };

  const toggle = () => {
    const next = !channel.connected;
    add(next ? 'Kết nối lại: phát lại mọi gói chưa có ack' : 'Mất kết nối', next ? 'ok' : 'err');
    channel.setConnected(next);
    refresh();
  };

  const list = [...rows.current.values()].reverse();
  const pending = channel.pending().length;
  return (
    <>
      <p className='hint'>
        QoS1 (at-least-once): tin nằm trong hàng chờ tới khi server ack. Gửi lúc mất kết nối thì không báo lỗi ngay, mà chờ; nối lại thì phát lại. Quá {TIMEOUT / 1000} giây không có ack thì báo{' '}
        <code>Publish Timed Out</code>. QoS0 thì gửi được hay không là xong.
      </p>
      <div className='toolbar'>
        <button className={channel.connected ? '' : 'primary'} onClick={toggle} data-testid='conn'>
          {channel.connected ? 'Ngắt kết nối' : 'Kết nối lại'}
        </button>
        <button className='primary' onClick={() => send(1)} data-testid='send1'>
          Gửi QoS1
        </button>
        <button onClick={() => send(0)} data-testid='send0'>
          Gửi QoS0
        </button>
        <button onClick={() => clock.advance(10_000)} data-testid='adv10'>
          +10 giây
        </button>
      </div>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={ackLost} onChange={(e) => setAckLost(e.target.checked)} data-testid='acklost' /> ack bị mất
        </label>
        <label className='switch'>
          <input type='checkbox' checked={dedupeOn} onChange={(e) => setDedupeOn(e.target.checked)} data-testid='dedupe' /> server khử trùng theo token
        </label>
      </div>
      <div className='stats'>
        <Stat label='kết nối' value={<output data-testid='connected' className={channel.connected ? 'ok' : 'err'}>{channel.connected ? 'đang nối' : 'mất'}</output>} />
        <Stat label='chờ ack' value={<output data-testid='pending'>{pending}</output>} />
        <Stat label='server nhận (kể cả trùng)' value={<output data-testid='received'>{server.current.received}</output>} />
        <Stat label='trùng bị bỏ' value={<output data-testid='dropped'>{server.current.dropped}</output>} />
      </div>
      <div className='split q1-split'>
        <div>
          <h2>Client</h2>
          <ul className='q1-list' data-testid='client-list'>
            {list.map((r) => {
              const left = Math.max(0, TIMEOUT - (clock.now() - r.sentAt));
              const waiting = r.qos === 1 && (r.state === 'queued' || r.state === 'sent');
              return (
                <li key={r.token} className={`q1-msg ${r.state}`} data-state={r.state}>
                  <span className='q1-tok'>{r.token}</span>
                  <span>{r.text}</span>
                  <span className='badge'>
                    QoS{r.qos} · {r.state}
                    {r.attempts > 1 ? ` ×${r.attempts}` : ''}
                  </span>
                  {waiting && (
                    <span className='q1-bar' title={`còn ${Math.ceil(left / 1000)} giây`}>
                      <span style={{ width: `${(left / TIMEOUT) * 100}%` }} />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h2>Server</h2>
          <ul className='q1-list' data-testid='server-list'>
            {server.current.shown.map((t, i) => (
              <li key={i} className={`q1-msg ${t.includes('trùng') ? 'dup' : ''}`}>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Log lines={lines} />
    </>
  );
}

// ───────────────────────── Tab 2 ─────────────────────────

interface SimResult {
  truth: number;
  absolute: number;
  delta: number;
  lost: number;
  gaps: number;
  packets: number;
}

/** PRNG nhỏ có seed để mỗi lần bấm cho kết quả tái lập được */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate(lossRate: number, seed: number, sessions = 300, intervalSec = 10): SimResult {
  const rand = mulberry32(seed);
  const res: SimResult = { truth: 0, absolute: 0, delta: 0, lost: 0, gaps: 0, packets: 0 };
  const received: WatchUpdate[] = [];
  for (let s = 0; s < sessions; s++) {
    const reporter = createWatchReporter('v1', 's' + s);
    let pos = 0;
    const spans = 1 + Math.floor(rand() * 4);
    for (let k = 0; k < spans; k++) {
      const start = pos;
      const length = 5 + Math.floor(rand() * 85); // giây
      // gói đầu khi bắt đầu phát, rồi mỗi intervalSec; dừng thì không gửi gói cuối (giống bản gốc)
      let lastSentDelta = 0;
      for (let t = 0; t <= length; t += intervalSec) {
        const u = reporter.makeUpdate(start, start + t, 'playing', false);
        res.packets++;
        const lost = rand() < lossRate;
        if (lost) res.lost++;
        else {
          received.push(u);
          res.delta += t - lastSentDelta; // cách ngây thơ: gói chỉ mang "+Δ giây từ gói trước"
        }
        lastSentDelta = t;
        res.truth += t === 0 ? 0 : intervalSec; // phần client đã báo (không tính đuôi sau nhịp cuối)
      }
      pos = start + length + Math.floor(rand() * 30); // tua đi một đoạn
      reporter.resetSpan();
    }
  }
  const server = totalWatchedMs(received);
  res.absolute = server.totalMs / 1000;
  res.gaps = server.gaps;
  return res;
}

function WatchPanel() {
  const [loss, setLoss] = useState(0.2);
  const [seed, setSeed] = useState(1);
  const r = useMemo(() => simulate(loss, seed), [loss, seed]);
  const pct = (x: number) => (r.truth ? Math.round((x / r.truth) * 100) : 0);
  return (
    <>
      <p className='hint'>
        Player gửi heartbeat lượt xem mỗi 10 giây trong lúc phát. Không retry, không chờ ack. 300 phiên xem giả lập, mỗi phiên 1–4 đoạn phát liên tục. So hai cách đóng gói:
        gói mang <b>tổng đã xem của đoạn</b> (<code>pf</code>, như Facebook) và gói mang <b>phần tăng thêm</b> (+10 giây).
      </p>
      <div className='toolbar'>
        <label>
          tỉ lệ mất gói <b data-testid='loss'>{Math.round(loss * 100)}%</b>{' '}
          <input type='range' min={0} max={0.6} step={0.05} value={loss} onChange={(e) => setLoss(Number(e.target.value))} data-testid='loss-range' />
        </label>
        <button onClick={() => setSeed((s) => s + 1)} data-testid='rerun'>
          Chạy lại
        </button>
      </div>
      <div className='stats'>
        <Stat label='gói gửi / mất' value={`${r.packets} / ${r.lost}`} />
        <Stat label='gói mất server phát hiện nhờ previous' value={<output data-testid='gaps'>{r.gaps}</output>} />
      </div>
      <div className='q1-bars'>
        <Bar label='client đã báo (chuẩn)' value={r.truth} pct={100} tone='muted' />
        <Bar label='server cộng: tổng tuyệt đối' value={r.absolute} pct={pct(r.absolute)} tone='ok' testid='abs' />
        <Bar label='server cộng: phần tăng' value={r.delta} pct={pct(r.delta)} tone='err' testid='delta' />
      </div>
      <p className='hint'>
        Mất một gói giữa đoạn: gói sau vẫn mang tổng mới, nên cách tuyệt đối chỉ hụt khi gói <i>cuối</i> của một đoạn bị mất. Cách phần tăng hụt đúng bằng tỉ lệ mất gói. Trường{' '}
        <code>previous</code> (bản gốc <code>pps</code>) không làm tăng tổng, nhưng cho server biết có gói mất: gói đến khai "lần trước tôi gửi X", server chưa từng thấy X.
      </p>
    </>
  );
}

function Bar({ label, value, pct, tone, testid }: { label: string; value: number; pct: number; tone: string; testid?: string }) {
  return (
    <div className='q1-barrow'>
      <span>{label}</span>
      <span className='q1-track'>
        <span className={`q1-fill ${tone}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </span>
      <output data-testid={testid}>
        {Math.round(value / 60)} phút · {pct}%
      </output>
    </div>
  );
}

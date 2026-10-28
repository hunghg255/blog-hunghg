import { useMemo, useRef, useState } from 'react';
import {
  createChannelFsm,
  createSubdomainLease,
  readSlots,
  type ChannelFsm,
  type LeaseStorage,
  type SubdomainLease,
} from '../lib/subdomainLease';
import { Log, Stat, useLog } from './shared';
import './SubdomainLeaseDemo.css';

const HOSTS = 7;
const TTL = 100_000;
const PER_HOST_LIMIT = 6; // giới hạn kết nối HTTP/1.1 mỗi host của trình duyệt

function memoryStorage(): LeaseStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() {
      return map.size;
    },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

type TabState = 'open' | 'hung' | 'away' | 'closed';
interface SimTab {
  name: string;
  state: TabState;
  lease: SubdomainLease;
}

export default function SubdomainLeaseDemo() {
  const [tab, setTab] = useState<'lease' | 'fsm'>('lease');
  return (
    <div className='page sl-demo'>
      <h1>Chia subdomain giữa các tab, long-poll theo bảng trạng thái</h1>
      <div className='sl-tabs' role='tablist'>
        <button role='tab' aria-selected={tab === 'lease'} className={tab === 'lease' ? 'active' : ''} onClick={() => setTab('lease')}>
          1. Lease subdomain
        </button>
        <button role='tab' aria-selected={tab === 'fsm'} className={tab === 'fsm' ? 'active' : ''} onClick={() => setTab('fsm')} data-testid='tab-fsm'>
          2. Máy trạng thái long-poll
        </button>
      </div>
      {tab === 'lease' ? <LeasePanel /> : <FsmPanel />}
    </div>
  );
}

// ───────────────────────── Tab 1 ─────────────────────────

function LeasePanel() {
  const { lines, add } = useLog();
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const clock = useRef(Date.UTC(2026, 9, 28, 9, 0, 0));
  const [maxConn, setMaxConn] = useState(2);
  const [split, setSplit] = useState(true);
  const storage = useMemo(memoryStorage, [maxConn]);
  // khi khác null, mọi lần đọc thấy ảnh chụp cũ (mô phỏng hai tab đọc cùng lúc)
  const snapshot = useRef<Map<string, string> | null>(null);
  const view = useMemo<LeaseStorage>(() => {
    const src = () => snapshot.current ?? storage.map;
    return {
      get length() {
        return src().size;
      },
      key: (i) => [...src().keys()][i] ?? null,
      getItem: (k) => src().get(k) ?? null,
      setItem: (k, v) => storage.setItem(k, v),
      removeItem: (k) => storage.removeItem(k),
    };
  }, [storage]);
  const tabs = useMemo<SimTab[]>(() => [], [maxConn]);
  const seq = useRef(0);

  const makeLease = (name: string) =>
    createSubdomainLease({ storage: view, maxConn, hosts: HOSTS, ttlMs: TTL, owner: name, now: () => clock.current, manual: true });

  const open = (count = 1) => {
    for (let i = 0; i < count; i++) {
      const n = seq.current++;
      const name = String.fromCharCode(65 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) : '');
      const lease = makeLease(name);
      const slot = lease.acquire();
      tabs.push({ name, state: 'open', lease });
      add(slot == null ? `Tab ${name}: hết slot → host chung edge-chat` : `Tab ${name}: slot ${slot} → ${slot % HOSTS}-edge-chat`, slot == null ? 'warn' : undefined);
    }
    refresh();
  };

  /** hai tab đọc storage cùng lúc, trước khi tab kia kịp ghi: cả hai chọn cùng slot */
  const openRace = () => {
    snapshot.current = new Map(storage.map);
    for (const n of ['X', 'Y']) {
      const name = n + seq.current++;
      // cùng điểm bắt đầu ngẫu nhiên, cùng ảnh chụp storage → cùng slot
      const lease = createSubdomainLease({ storage: view, maxConn, hosts: HOSTS, ttlMs: TTL, owner: name, now: () => clock.current, random: () => 0.37, manual: true });
      const slot = lease.acquire();
      tabs.push({ name, state: 'open', lease });
      add(`Tab ${name} (mở cùng lúc): slot ${slot}`, 'warn');
    }
    snapshot.current = null;
    refresh();
  };

  const advance = (ms: number) => {
    const step = TTL / 2;
    for (let t = 0; t < ms; t += step) {
      clock.current += step;
      for (const tb of tabs) {
        if (tb.state !== 'open' || tb.lease.slot == null) continue;
        const before = tb.lease.slot;
        const kept = tb.lease.renew();
        if (!kept) add(`Tab ${tb.name}: slot ${before} đã bị tab khác giữ → chuyển sang ${tb.lease.slot ?? 'host chung'}`, 'ok');
      }
    }
    // tab đang ở host chung thử xin lại nếu có slot trống
    for (const tb of tabs) if (tb.state === 'open' && tb.lease.slot == null && tb.lease.acquire() != null) add(`Tab ${tb.name}: có slot trống, chuyển sang slot ${tb.lease.slot}`, 'ok');
    refresh();
  };

  const act = (tb: SimTab, what: 'close' | 'hang' | 'away' | 'back') => {
    if (what === 'close') {
      tb.lease.release();
      tb.state = 'closed';
      add(`Tab ${tb.name} đóng: pagehide xoá lease ngay`);
    } else if (what === 'hang') {
      tb.state = 'hung';
      add(`Tab ${tb.name} treo: không gia hạn, lease hết hạn sau ${TTL / 1000}s`, 'err');
    } else if (what === 'away') {
      tb.lease.release();
      tb.state = 'away';
      add(`Tab ${tb.name} sang trang khác (vào bfcache): pagehide xoá lease`);
    } else {
      tb.state = 'open';
      const slot = tb.lease.acquire();
      add(`Tab ${tb.name} bấm Back (pageshow persisted): xin lại → ${slot ?? 'host chung'}. Bản gốc không xin lại, tab ở host chung`, 'ok');
    }
    refresh();
  };

  const live = tabs.filter((t) => t.state === 'open' || t.state === 'hung');
  const byHost: string[][] = Array.from({ length: HOSTS }, () => []);
  const shared: string[] = [];
  for (const t of live) {
    const host = split ? t.lease.host : null;
    if (host == null) shared.push(t.name);
    else byHost[host].push(t.name);
  }
  const slotOwners = new Map<number, string[]>();
  for (const t of live) if (t.lease.slot != null) slotOwners.set(t.lease.slot, [...(slotOwners.get(t.lease.slot) ?? []), t.name]);
  const dup = [...slotOwners.values()].filter((v) => v.length > 1).length;
  const dupNames = new Set([...slotOwners.values()].filter((v) => v.length > 1).flat());
  const sharedLoad = shared.length;
  const records = readSlots(storage);

  return (
    <>
      <p className='hint'>
        Mỗi tab giữ một long-poll mở liên tục. Dồn hết vào một host thì tới tab thứ {PER_HOST_LIMIT} là trình duyệt hết kết nối cho host đó, mọi request khác tới host phải xếp hàng.
        Mỗi tab xin một slot trong <code>(max_conn − 1) × 7</code> slot, ghi lease vào localStorage và gia hạn mỗi 50 giây (đồng hồ giả).
      </p>
      <div className='toolbar'>
        <label>
          max_conn{' '}
          <select value={maxConn} onChange={(e) => setMaxConn(Number(e.target.value))} data-testid='maxconn'>
            {[1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n} → {(n - 1) * HOSTS} slot
              </option>
            ))}
          </select>
        </label>
        <label className='switch'>
          <input type='checkbox' checked={split} onChange={(e) => setSplit(e.target.checked)} data-testid='split' /> chia subdomain
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={() => open(1)} data-testid='open1'>
          Mở tab
        </button>
        <button onClick={() => open(5)} data-testid='open5'>
          Mở 5 tab
        </button>
        <button onClick={openRace} data-testid='race'>
          Mở 2 tab cùng lúc
        </button>
        <button onClick={() => advance(TTL / 2)} data-testid='adv50'>
          +50 giây
        </button>
        <button onClick={() => advance(TTL * 1.5)}>+150 giây</button>
      </div>
      <div className='stats'>
        <Stat label='long-poll ở host chung' value={<output data-testid='shared'>{sharedLoad}</output>} />
        <Stat label={`kết nối còn lại ở host chung (/${PER_HOST_LIMIT})`} value={<output className={sharedLoad >= PER_HOST_LIMIT ? 'err' : ''}>{Math.max(0, PER_HOST_LIMIT - sharedLoad)}</output>} />
        <Stat label='slot bị hai tab giữ' value={<output data-testid='dup'>{dup}</output>} />
      </div>
      <div className='sl-hosts'>
        {byHost.map((names, i) => (
          <div key={i} className='sl-host'>
            <b>{i}-edge-chat</b>
            <div>{names.map((n) => <span key={n} className={`sl-chip ${dupNames.has(n) ? 'dup' : ''}`}>{n}</span>)}</div>
          </div>
        ))}
        <div className={`sl-host sl-shared ${sharedLoad >= PER_HOST_LIMIT ? 'full' : ''}`} data-testid='shared-host'>
          <b>edge-chat (chung)</b>
          <div>{shared.map((n) => <span key={n} className='sl-chip'>{n}</span>)}</div>
        </div>
      </div>
      <div className='sl-tabsim'>
        {tabs.filter((t) => t.state !== 'closed').map((t) => (
          <div key={t.name} className={`card sl-tab ${t.state}`}>
            <b>Tab {t.name}</b> <span className='badge'>{t.state === 'open' ? (t.lease.slot == null ? 'chung' : `slot ${t.lease.slot}`) : t.state}</span>
            <div className='sl-actions'>
              {t.state === 'away' ? (
                <button onClick={() => act(t, 'back')}>Back</button>
              ) : (
                <>
                  <button onClick={() => act(t, 'close')}>Đóng</button>
                  <button onClick={() => act(t, 'hang')} disabled={t.state === 'hung'}>Treo</button>
                  <button onClick={() => act(t, 'away')}>Rời trang</button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      <details className='sl-store'>
        <summary>localStorage ({records.length} khoá)</summary>
        <table>
          <tbody>
            {records.map((r) => (
              <tr key={r.slot}>
                <td>channel_sub:{r.slot}</td>
                <td>{r.owner}</td>
                <td>{Math.round((clock.current - r.at) / 1000)}s trước{clock.current - r.at > TTL ? ' (hết hạn)' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
      <Log lines={lines} />
    </>
  );
}

// ───────────────────────── Tab 2 ─────────────────────────

interface Timer {
  at: number;
  fn: () => void;
  live: boolean;
}

function FsmPanel() {
  const { lines, add } = useLog(80);
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const clock = useRef(0);
  const timers = useRef<Timer[]>([]);
  const inflight = useRef<number | null>(null);
  const oldIds = useRef<number[]>([]);
  const counts = useRef({ stale: 0, throttled: 0, enters: 0 });

  const fsm = useMemo<ChannelFsm>(() => {
    const f = createChannelFsm({
      now: () => clock.current,
      schedule: (fn, ms) => {
        const t = { at: clock.current + ms, fn, live: true };
        timers.current.push(t);
        return () => void (t.live = false);
      },
      onEnter: (state, id) => {
        counts.current.enters++;
        inflight.current = /init|pull|ping|reconnect/.test(state) ? id : null;
      },
      onEvent: (e) => {
        const t = `t=${(clock.current / 1000).toFixed(1)}s`;
        if (e.type === 'exit' || e.type === 'defer') {
          // request cũ xong (hoặc bị bỏ): nhớ id để thử "phản hồi muộn"
          if (inflight.current != null) oldIds.current.push(inflight.current);
          inflight.current = null;
        }
        if (e.type === 'enter') add(`${t} vào ${e.state} (stateId ${e.stateId})`);
        else if (e.type === 'defer') {
          if (e.reason === 'throttle') counts.current.throttled++;
          add(`${t} chờ ${(e.delayMs / 1000).toFixed(1)}s rồi mới vào ${e.state} (${e.reason === 'throttle' ? 'chặn tần suất' : 'backoff'})`, 'warn');
        } else if (e.type === 'stale') {
          counts.current.stale++;
          add(`${t} bỏ phản hồi "${e.status}" của stateId ${e.stateId} (hiện tại ${e.current})`, 'muted');
        } else add(`${t} ${e.from} + ${e.status} → ${e.to}`, e.status === 'ok' ? 'ok' : e.status.startsWith('sys') ? undefined : 'err');
      },
    });
    f.enter('init!');
    return f;
  }, [add]);

  const reply = (status: string) => {
    if (inflight.current == null) {
      add('Không có request nào đang chờ (đang ở idle)', 'muted');
      return;
    }
    clock.current += 200;
    fsm.exit(inflight.current, status);
    refresh();
  };

  const runNext = () => {
    const next = timers.current.filter((t) => t.live).sort((a, b) => a.at - b.at)[0];
    if (!next) return;
    clock.current = Math.max(clock.current, next.at);
    next.live = false;
    next.fn();
    refresh();
  };

  const burst = () => {
    // server trả ok ngay lập tức nhiều lần: pull! → pull! → … đến khi bị chặn tần suất
    for (let i = 0; i < 40; i++) {
      if (inflight.current == null) runNext();
      if (inflight.current == null) break;
      clock.current += 50;
      fsm.exit(inflight.current, 'ok');
    }
    refresh();
  };

  const late = () => {
    const id = oldIds.current[oldIds.current.length - 1];
    if (id == null) return add('Chưa có request cũ nào', 'muted');
    fsm.exit(id, 'error');
    refresh();
  };

  const pending = fsm.pending;
  return (
    <>
      <p className='hint'>
        Mỗi kết quả request (<code>ok</code>, <code>error</code>, <code>refresh_110</code>…) tra bảng để ra state kế tiếp. <code>pull!</code> đi ngay; <code>reconnect</code> không có <code>!</code> nên phải chờ
        backoff <code>min(5s·2^(n−1), 320s)·(1 + rand·0,5)</code>. Đồng hồ giả: bấm "Chạy tới hẹn kế tiếp" để thời gian trôi.
      </p>
      <div className='sl-fsm'>
        {['idle', 'init', 'pull', 'ping', 'reconnect', 'shutdown'].map((s) => (
          <span key={s} className={`sl-state ${fsm.state === s ? 'on' : ''} ${pending?.state === s ? 'next' : ''}`} data-testid={`st-${s}`}>
            {s}
          </span>
        ))}
      </div>
      <div className='stats'>
        <Stat label='state' value={<output data-testid='state'>{fsm.state}</output>} />
        <Stat label='stateId' value={<output data-testid='stateid'>{fsm.stateId}</output>} />
        <Stat label='lỗi liên tiếp' value={<output data-testid='retries'>{fsm.retries}</output>} />
        <Stat label='đang chờ' value={<output data-testid='pending'>{pending ? `${pending.state} sau ${((pending.at - clock.current) / 1000).toFixed(1)}s` : '—'}</output>} />
        <Stat label='phản hồi muộn bị bỏ' value={<output data-testid='stale'>{counts.current.stale}</output>} />
        <Stat label='lần bị chặn tần suất' value={<output data-testid='throttled'>{counts.current.throttled}</output>} />
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={() => reply('ok')} data-testid='ok'>
          Server: ok
        </button>
        <button onClick={() => reply('error')} data-testid='error'>
          Server: lỗi
        </button>
        <button onClick={() => reply('refresh_110')}>refresh_110</button>
        <button onClick={() => reply('refresh_112')}>refresh_112</button>
        <button onClick={() => (fsm.signal('sys_offline'), refresh())}>Mất mạng</button>
        <button onClick={() => (fsm.signal('sys_online'), refresh())}>Có mạng</button>
      </div>
      <div className='toolbar'>
        <button onClick={runNext} disabled={!pending} data-testid='run'>
          Chạy tới hẹn kế tiếp
        </button>
        <button onClick={late} data-testid='late'>
          Phản hồi muộn của request cũ
        </button>
        <button onClick={burst} data-testid='burst'>
          Server trả ok ngay ×40
        </button>
      </div>
      <Log lines={lines} />
    </>
  );
}

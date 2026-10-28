import { useMemo, useRef, useState } from 'react';
import {
  checkProxyCache,
  createCrashMonitor,
  isCrashed,
  type CrashMonitor,
  type SessionRecord,
  type StorageLike,
} from '../lib/crashHeartbeat';
import { Log, Stat, useLog } from './shared';
import './CrashHeartbeatDemo.css';

const KEY = 'crash:demo';
const BEAT = 5_000;
const CRASH_AFTER = 60_000; // demo dùng 1 phút cho nhanh; bản gốc là 10 phút

type TabState = 'alive' | 'hidden' | 'crashed' | 'closed';
interface Tab {
  name: string;
  state: TabState;
  monitor: CrashMonitor;
  /** kiểu ngây thơ: mỗi tab tự báo mọi crash nó thấy */
  naiveSeen: Set<string>;
}

function memoryStorage(): StorageLike & { dump(): string } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    dump: () => map.get(KEY) ?? '{}',
  };
}

export default function CrashHeartbeatDemo() {
  const { lines, add } = useLog();
  const [, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const clock = useRef(Date.UTC(2026, 9, 28, 9, 0, 0));
  const counts = useRef({ claimed: 0, naive: 0 });
  const storage = useMemo(memoryStorage, []);

  const tabs = useMemo<Tab[]>(() => {
    const list = ['A', 'B', 'C', 'D'].map((name) => {
      const tab = { name, state: 'alive' as TabState, naiveSeen: new Set<string>() } as Tab;
      tab.monitor = createCrashMonitor({
        storage,
        key: KEY,
        sessionId: `tab-${name}`,
        now: () => clock.current,
        heartbeatMs: BEAT,
        crashAfterMs: CRASH_AFTER,
        manual: true,
        onCrash: (id) => {
          counts.current.claimed++;
          add(`Tab ${name} báo cáo: ${id} đã crash (nhận việc hai pha, chỉ một tab báo)`, 'ok');
        },
      });
      return tab;
    });
    list.forEach((t) => t.monitor.start());
    return list;
  }, [storage, add]);

  const tick = (seconds: number) => {
    for (let s = 0; s < seconds; s += BEAT / 1000) {
      clock.current += BEAT;
      // thứ tự các tab chạy nhịp là ngẫu nhiên, như thật
      const live = tabs
        .filter((t) => t.state === 'alive' || t.state === 'hidden')
        .sort(() => Math.random() - 0.5);
      for (const tab of live) {
        tab.monitor.beat();
        const sessions = JSON.parse(storage.dump()) as Record<string, SessionRecord>;
        for (const [id, rec] of Object.entries(sessions)) {
          if (isCrashed(rec, clock.current, CRASH_AFTER) && !tab.naiveSeen.has(id)) {
            tab.naiveSeen.add(id);
            counts.current.naive++;
          }
        }
      }
    }
    refresh();
  };

  const setState = (tab: Tab, state: TabState) => {
    if (tab.state === 'closed' || tab.state === 'crashed') return;
    tab.state = state;
    if (state === 'hidden') tab.monitor.setVisible(false);
    if (state === 'alive') tab.monitor.setVisible(true);
    if (state === 'closed') tab.monitor.stop();
    // crashed: không làm gì cả, đó chính là crash
    add(
      state === 'crashed'
        ? `Tab ${tab.name} crash: ngừng ghi heartbeat, bản ghi vẫn "active"`
        : `Tab ${tab.name} → ${state}`,
      state === 'crashed' ? 'err' : undefined,
    );
    refresh();
  };

  const sessions = JSON.parse(storage.dump()) as Record<string, SessionRecord>;

  return (
    <div className='page crash-demo'>
      <h1>Phát hiện crash qua heartbeat localStorage</h1>
      <p className='hint'>
        4 tab mô phỏng dùng chung một khoá. Mỗi nhịp 5 giây (đồng hồ giả), tab còn sống ghi bản ghi
        của mình. Tab "crash" ngừng ghi mà không kịp đóng; sau {CRASH_AFTER / 1000} giây im lặng,
        các tab khác thấy nó. Tab ẩn chuyển "inactive" nên không bị tính là crash.
      </p>
      <div className='crash-tabs'>
        {tabs.map((tab) => (
          <div
            key={tab.name}
            className={`card crash-tab ${tab.state}`}
            data-testid={`tab-${tab.name}`}
          >
            <b>Tab {tab.name}</b>
            <span className='badge'>{tab.state}</span>
            <div className='crash-actions'>
              <button onClick={() => setState(tab, 'crashed')} data-testid={`crash-${tab.name}`}>
                Crash
              </button>
              <button onClick={() => setState(tab, tab.state === 'hidden' ? 'alive' : 'hidden')}>
                {tab.state === 'hidden' ? 'Hiện' : 'Ẩn'}
              </button>
              <button onClick={() => setState(tab, 'closed')}>Đóng</button>
            </div>
          </div>
        ))}
      </div>
      <div className='toolbar'>
        <button onClick={() => tick(5)}>+5 giây</button>
        <button className='primary' onClick={() => tick(60)} data-testid='tick-minute'>
          +1 phút
        </button>
      </div>
      <div className='stats'>
        <Stat
          label='báo cáo (hai pha)'
          value={<output data-testid='claimed'>{counts.current.claimed}</output>}
        />
        <Stat
          label='báo cáo nếu mỗi tab tự báo'
          value={<output data-testid='naive'>{counts.current.naive}</output>}
        />
      </div>
      <div className='crash-table-wrap'>
        <table className='crash-table'>
          <thead>
            <tr>
              <th>session</th>
              <th>status</th>
              <th>im lặng</th>
              <th>nhận việc</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(sessions).map(([id, rec]) => (
              <tr key={id} className={isCrashed(rec, clock.current, CRASH_AFTER) ? 'crashed' : ''}>
                <td>{id}</td>
                <td>{rec.status}</td>
                <td>{Math.round((clock.current - rec.lastUpdated) / 1000)}s</td>
                <td>
                  {rec.claimBy
                    ? `${rec.claimBy} (${Math.round((clock.current - rec.claimAt!) / 1000)}s trước)`
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ProxyCheck />
      <Log lines={lines} />
    </div>
  );
}

function ProxyCheck() {
  const [rendered, setRendered] = useState('100004');
  const [cookie, setCookie] = useState('100004');
  const result = checkProxyCache(rendered, cookie || null);
  return (
    <div className='card crash-proxy'>
      <h2>Dò proxy cache hỏng</h2>
      <p className='hint'>
        Server nhúng user id vào HTML. Cookie <code>c_user</code> là của người đang dùng trình
        duyệt. Khác nhau nghĩa là HTML được render cho người khác rồi bị proxy cache lại.
      </p>
      <div className='crash-proxy-fields'>
        <label>
          user id trong HTML
          <input value={rendered} onChange={(e) => setRendered(e.target.value)} />
        </label>
        <label>
          cookie c_user
          <input value={cookie} onChange={(e) => setCookie(e.target.value)} />
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={() => (setRendered('100004'), setCookie('100004'))}>Trang đúng</button>
        <button
          onClick={() => (setRendered('100004'), setCookie('200777'))}
          data-testid='proxy-broken'
        >
          Proxy trả trang của người khác
        </button>
        <button onClick={() => (setRendered('0'), setCookie('200777'))}>
          Trang chưa đăng nhập
        </button>
      </div>
      <output data-testid='proxy-result' className={result.broken ? 'crash-bad' : 'crash-good'}>
        {result.broken
          ? `Hỏng: HTML của ${result.renderedUserId}, trình duyệt của ${result.cookieUserId} → gửi tín hiệu về server`
          : 'Ổn: không có dấu hiệu cache nhầm'}
      </output>
    </div>
  );
}

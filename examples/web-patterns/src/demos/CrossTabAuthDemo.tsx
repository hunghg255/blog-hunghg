import { useEffect, useMemo, useRef, useState } from 'react';
import { AUTH_KEYS, readAuth, toAuthState, watchAuthState, type AuthState } from '../lib/crossTabAuth';
import { byteLength, guardCookieSize, listCookies, type CookieJar } from '../lib/cookieGuard';
import { Log, Stat, useLog, type LogLine } from './shared';
import './CrossTabAuthDemo.css';

const CHANNEL = 'demo:cross-tab-auth';
type Msg = { type: 'log'; tab: string; text: string; tone?: LogLine['tone'] };

const params = new URLSearchParams(location.search);
const frame = params.get('frame');

export default function CrossTabAuthDemo() {
  return frame ? <AuthTab name={frame} naive={params.get('naive') === '1'} /> : <Host />;
}

function Host() {
  const { lines, add, clear } = useLog(40);
  const [naive, setNaive] = useState(false);

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<Msg>) => add(`Tab ${event.data.tab}: ${event.data.text}`, event.data.tone);
    return () => channel.close();
  }, [add]);

  const theme = params.get('theme') ?? '';
  const src = (tab: string) =>
    `${location.pathname}?frame=${tab}&naive=${naive ? 1 : 0}&theme=${theme}#/cross-tab-auth`;

  return (
    <div className='page'>
      <h1>Đồng bộ đăng nhập giữa tab + giới hạn cookie</h1>
      <section className='card cta-section'>
        <h2>1. Đồng bộ đăng nhập (Elastic Cloud)</h2>
        <p className='hint'>
          Hai khung là hai tab. Đăng nhập ở tab A: tab B reload để vào trạng thái đã đăng nhập. Bấm "Làm
          mới token" nhiều lần: tab B đứng yên vì trạng thái không đổi. Bật "Cách ngây thơ" để thấy tab B
          reload cả khi chỉ làm mới token.
        </p>
        <div className='toolbar'>
          <label className='switch'>
            <input
              type='checkbox'
              checked={naive}
              onChange={(e) => {
                setNaive(e.target.checked);
                clear();
              }}
            />
            Cách ngây thơ (reload mỗi khi localStorage đổi)
          </label>
        </div>
        <div className='cta-tabs'>
          {['A', 'B'].map((tab) => (
            <iframe key={tab + naive} title={`Tab ${tab}`} src={src(tab)} />
          ))}
        </div>
        <Log lines={lines} />
      </section>
      <CookieGuardDemo />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Một tab của app
// ---------------------------------------------------------------------------

const HOUR = 60 * 60 * 1000;

function AuthTab({ name, naive }: { name: string; naive: boolean }) {
  const [state, setState] = useState<AuthState>(() => toAuthState(readAuth()));
  const [reloads, setReloads] = useState(0);
  const watcherRef = useRef<ReturnType<typeof watchAuthState> | null>(null);
  const logRef = useRef<(text: string, tone?: LogLine['tone']) => void>(() => {});

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL);
    const log = (text: string, tone?: LogLine['tone']) => channel.postMessage({ type: 'log', tab: name, text, tone } satisfies Msg);
    logRef.current = log;
    // "reload" giả: đọc lại trạng thái từ đầu và đếm số lần (reload thật sẽ mất log của demo)
    const reload = (why: string) => {
      setReloads((n) => n + 1);
      setState(toAuthState(readAuth()));
      log(`🔄 reload (${why})`, 'warn');
    };

    const watcher = watchAuthState({
      onStateChange: (next, prev) =>
        reload(`${describe(prev)} → ${describe(next)}`),
    });
    watcherRef.current = watcher;

    // Cách ngây thơ: storage đổi là reload, không cần biết đổi cái gì
    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_KEYS.expires || event.key === AUTH_KEYS.sudoExpires) reload(`${event.key} đổi`);
    };
    if (naive) {
      watcher.stop();
      window.addEventListener('storage', onStorage);
    }
    return () => {
      watcher.stop();
      window.removeEventListener('storage', onStorage);
      channel.close();
    };
  }, [name, naive]);

  const write = (expiresAt: number | null, sudoExpiresAt: number | null, what: string) => {
    watcherRef.current?.write({ expiresAt, sudoExpiresAt });
    setState(toAuthState({ expiresAt, sudoExpiresAt }));
    logRef.current(what, 'muted');
  };

  const current = readAuth();
  return (
    <div className='cta-tab'>
      <div className='cta-row'>
        <b>Tab {name}</b>
        <span className={`badge ${state.loggedIn ? 'ok' : 'err'}`}>{describe(state)}</span>
        <span className='muted'>reload: {reloads}</span>
      </div>
      <div className='cta-row cta-actions'>
        {!state.loggedIn ? (
          <button className='primary' onClick={() => write(Date.now() + HOUR, null, '🔑 đăng nhập')}>
            Đăng nhập
          </button>
        ) : (
          <>
            <button onClick={() => write(Date.now() + 2 * HOUR, current.sudoExpiresAt, '♻️ làm mới token (hạn mới, vẫn hợp lệ)')}>
              Làm mới token
            </button>
            <button onClick={() => write(current.expiresAt, state.sudo ? null : Date.now() + HOUR / 6, state.sudo ? '⬇️ bỏ sudo' : '⬆️ lấy quyền sudo')}>
              {state.sudo ? 'Bỏ sudo' : 'Sudo'}
            </button>
            <button onClick={() => write(null, null, '🚪 đăng xuất')}>Đăng xuất</button>
          </>
        )}
      </div>
    </div>
  );
}

function describe(state: AuthState) {
  if (!state.loggedIn) return 'Khách';
  return state.sudo ? 'Đã đăng nhập + sudo' : 'Đã đăng nhập';
}

// ---------------------------------------------------------------------------
// Giới hạn kích thước cookie (InVision), dùng "hũ cookie" giả trong bộ nhớ
// ---------------------------------------------------------------------------

/** Mô phỏng document.cookie cho một domain: hiểu Max-Age và expires như trình duyệt. */
function createMemoryJar(): CookieJar {
  const store = new Map<string, string>();
  return {
    read: () => [...store].map(([k, v]) => `${k}=${v}`).join('; '),
    write(cookie) {
      const [pair, ...attrs] = cookie.split(';').map((s) => s.trim());
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      let expired = false;
      for (const attr of attrs) {
        const [k, v = ''] = attr.split('=');
        if (k.toLowerCase() === 'max-age' && Number(v) <= 0) expired = true;
        if (k.toLowerCase() === 'expires') {
          const time = Date.parse(v);
          // ngày không hợp lệ (vd một con số) -> trình duyệt bỏ qua thuộc tính này
          if (!Number.isNaN(time) && time <= Date.now()) expired = true;
        }
      }
      if (expired) store.delete(name);
      else store.set(name, value);
    },
  };
}

const LIMIT_GUARD = 13 * 1024;
const LIMIT_CDN = 16 * 1024;
const randomValue = (bytes: number) => Array.from({ length: bytes }, () => 'abcdef0123456789'[Math.floor(Math.random() * 16)]).join('');

function CookieGuardDemo() {
  const jar = useMemo(() => {
    const j = createMemoryJar();
    j.write('session=' + randomValue(300));
    j.write('csrf=' + randomValue(64));
    return j;
  }, []);
  const { lines, add } = useLog(20);
  const [, rerender] = useState(0);
  const [legacyDelete, setLegacyDelete] = useState(false);
  const counter = useRef(0);

  const addTracking = () => {
    const name = (counter.current % 2 ? 'mp_' : 'amplitude_') + counter.current++;
    jar.write(`${name}=${randomValue(2000)}`);
    rerender((n) => n + 1);
  };

  const runGuard = () => {
    if (legacyDelete) {
      // cách xoá trong bản gốc: expires là một con số -> không hợp lệ
      const before = byteLength(jar.read());
      for (const c of listCookies(jar.read())) {
        if (['amplitude', 'mp_'].some((p) => c.name.includes(p))) jar.write(`${c.name}=;expires=${+new Date()};path=/`);
      }
      const left = listCookies(jar.read()).filter((c) => c.name.startsWith('amplitude') || c.name.startsWith('mp_'));
      add(`bản gốc: ${before} → ${byteLength(jar.read())} byte, nhưng ${left.length} cookie rỗng vẫn còn trong hũ`, 'warn');
    } else {
      const report = guardCookieSize({ jar, maxBytes: LIMIT_GUARD });
      add(
        report.removed.length
          ? `🧹 ${report.before} → ${report.after} byte, xoá ${report.removed.join(', ')}`
          : `✓ ${report.before} byte, dưới ngưỡng, không làm gì`,
        report.removed.length ? 'ok' : 'muted',
      );
    }
    rerender((n) => n + 1);
  };

  const cookies = listCookies(jar.read());
  const total = byteLength(jar.read());
  const pct = (n: number) => `${Math.min(100, (n / (LIMIT_CDN * 1.15)) * 100)}%`;

  return (
    <section className='card cta-section'>
      <h2>2. Giới hạn kích thước cookie (InVision)</h2>
      <p className='hint'>
        Mỗi lần bấm, một script analytics ghi thêm cookie 2KB. Vượt vạch đỏ 16KB thì CDN từ chối request.
        Guard dọn khi quá 13KB, xoá cookie analytics to nhất trước.
      </p>
      <div className='toolbar'>
        <button onClick={addTracking}>＋ Analytics ghi cookie 2KB</button>
        <button className='primary' onClick={runGuard}>
          🧹 Chạy guard
        </button>
        <label className='switch'>
          <input type='checkbox' checked={legacyDelete} onChange={(e) => setLegacyDelete(e.target.checked)} />
          Xoá kiểu bản gốc (expires=timestamp)
        </label>
      </div>
      <div className='cta-meter' aria-label={`Tổng ${total} byte`}>
        <div className={`cta-fill ${total > LIMIT_CDN ? 'over' : total > LIMIT_GUARD ? 'near' : ''}`} style={{ width: pct(total) }} />
        <div className='cta-line guard' style={{ left: pct(LIMIT_GUARD) }} title='13KB' />
        <div className='cta-line cdn' style={{ left: pct(LIMIT_CDN) }} title='16KB' />
      </div>
      <div className='stats'>
        <Stat label='Header Cookie' value={`${(total / 1024).toFixed(1)} KB`} />
        <Stat label='Số cookie' value={cookies.length} />
        <Stat label='Request' value={<strong className={total > LIMIT_CDN ? 'err' : 'ok'}>{total > LIMIT_CDN ? '431/400' : '200 OK'}</strong>} />
      </div>
      <div className='cta-cookies'>
        {cookies.map((c) => (
          <span key={c.name} className='cta-chip'>
            {c.name} <small>{c.bytes}B</small>
          </span>
        ))}
      </div>
      <Log lines={lines} />
    </section>
  );
}

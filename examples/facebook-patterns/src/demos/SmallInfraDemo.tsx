import { useEffect, useMemo, useRef, useState } from 'react';
import { cookieDomain, createCookieStore, mouseStopSubscribers, onMouseStop, resolvePolicy, simpleHash, type CookieConfig } from '../lib/smallInfra';
import { Log, Stat, useLog } from './shared';
import './SmallInfraDemo.css';

// bảng chính sách cookie: một chỗ duy nhất. path = thư mục của trang demo để không đụng phần còn lại của blog
const DEMO_PATH = new URL('.', location.href).pathname;
const CONFIG: CookieConfig = {
  demo_locale: { ttlSeconds: 7 * 24 * 3600, path: DEMO_PATH, sameSite: 'Lax' },
  demo_datr: { ttlSeconds: 2 * 365 * 24 * 3600, path: DEMO_PATH, sameSite: 'None' },
  demo_presence: { ttlSeconds: 0, path: DEMO_PATH, sameSite: 'Strict' },
};

const NAMES = ['demo_locale', '_js_demo_datr', 'demo_presence', 'demo_tracking'];

function CookiePanel() {
  // demo không rút domain (để cookie chỉ thuộc host hiện tại); xem ví dụ domain bên dưới
  const store = useMemo(() => createCookieStore({ config: CONFIG }), []);
  const [name, setName] = useState(NAMES[0]);
  const [value, setValue] = useState('vi_VN');
  const [written, setWritten] = useState<string | null>(null);
  const [current, setCurrent] = useState('');
  const { lines, add } = useLog(12);
  const policy = resolvePolicy(CONFIG, name);
  const refresh = () => setCurrent(document.cookie.split('; ').filter((c) => c.includes('demo_')).join('; ') || '(trống)');
  useEffect(refresh, []);

  const set = () => {
    const cookie = store.set(name, value);
    setWritten(cookie);
    add(cookie ? `set ${name}` : `từ chối ${name}: không có trong bảng chính sách`, cookie ? 'ok' : 'warn');
    refresh();
  };
  // bản gốc: setWithoutChecks(name, value, ttl) với ttl == 1 nghĩa là "xoá"
  const legacyTtlOne = () => {
    const cookie = store.clear(name);
    setWritten(cookie);
    add(`bản gốc: TTL = 1 → hiểu là xoá ${name}`, 'muted');
    refresh();
  };

  return (
    <section className='si-panel'>
      <h2>1. Cookie theo bảng chính sách (CookieCore)</h2>
      <div className='toolbar'>
        <select value={name} onChange={(e) => setName(e.target.value)} aria-label='Tên cookie'>
          {NAMES.map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
        <input type='text' value={value} onChange={(e) => setValue(e.target.value)} aria-label='Giá trị' style={{ width: 120 }} />
        <button className='primary' onClick={set}>
          Set
        </button>
        <button onClick={legacyTtlOne}>Set với TTL = 1</button>
      </div>
      <p className='hint' data-testid='policy'>
        {policy
          ? `Chính sách "${policy.policyKey}"${policy.policyKey !== name ? ' (qua tiền tố _js_)' : ''}: path=${policy.path}, ${policy.ttlSeconds ? `ttl ${policy.ttlSeconds}s` : 'cookie phiên'}, ${policy.secure ? 'secure' : 'insecure'}, SameSite=${policy.sameSite}`
          : 'Không có chính sách: store.set() sẽ từ chối.'}
      </p>
      <pre className='si-pre' data-testid='written'>
        {written ?? '–'}
      </pre>
      <p className='hint'>
        document.cookie: <code data-testid='jar'>{current}</code>
      </p>
      <p className='hint'>
        Domain: <code>www.facebook.com</code> → <code>{cookieDomain('www.facebook.com', ['facebook.com'])}</code>, <code>m.facebook.com</code> →{' '}
        <code>{cookieDomain('m.facebook.com', ['facebook.com'])}</code>, host lạ → <code>{String(cookieDomain('example.org', ['facebook.com']))}</code> (host-only).
      </p>
      <Log lines={lines} />
    </section>
  );
}

const SAMPLE_ERRORS = `TypeError: Cannot read properties of undefined (reading 'id')
TypeError: Cannot read properties of undefined (reading 'id')
NetworkError: Failed to fetch
TypeError: Cannot read properties of null (reading 'focus')
NetworkError: Failed to fetch
TypeError: Cannot read properties of undefined (reading 'id')`;

function HashPanel() {
  const [text, setText] = useState(SAMPLE_ERRORS);
  const [separate, setSeparate] = useState(true);
  const buckets = useMemo(() => {
    const map = new Map<string, { message: string; count: number }>();
    for (const line of text.split('\n').filter(Boolean)) {
      const [type, ...rest] = line.split(': ');
      const key = simpleHash([type, rest.join(': ')], { separate });
      const entry = map.get(key) ?? { message: line, count: 0 };
      entry.count++;
      map.set(key, entry);
    }
    return [...map.entries()];
  }, [text, separate]);
  const collide = [simpleHash(['ab', 'c'], { separate }), simpleHash(['a', 'bc'], { separate })];
  return (
    <section className='si-panel'>
      <h2>2. Hash 6 ký tự để gom lỗi (getSimpleHash)</h2>
      <textarea className='si-text' value={text} onChange={(e) => setText(e.target.value)} rows={5} aria-label='Danh sách lỗi' />
      <label className='switch'>
        <input type='checkbox' checked={!separate} onChange={(e) => setSeparate(!e.target.checked)} /> Nối các phần liền nhau như bản gốc
      </label>
      <ul className='si-buckets'>
        {buckets.map(([key, b]) => (
          <li key={key}>
            <code>{key}</code> ×{b.count} <span className='muted'>{b.message}</span>
          </li>
        ))}
      </ul>
      <p className='hint' data-testid='collide'>
        hash("ab","c") = <code>{collide[0]}</code>, hash("a","bc") = <code>{collide[1]}</code> {collide[0] === collide[1] ? '→ trùng nhau' : '→ khác nhau'}
      </p>
    </section>
  );
}

function MouseStopPanel() {
  const [enabled, setEnabled] = useState(true);
  const [moves, setMoves] = useState(0);
  const [stops, setStops] = useState(0);
  const [subs, setSubs] = useState(0);
  const moveCount = useRef(0);
  useEffect(() => {
    if (!enabled) {
      setSubs(mouseStopSubscribers());
      return;
    }
    const off = onMouseStop(() => setStops((n) => n + 1));
    setSubs(mouseStopSubscribers());
    return () => {
      off();
      setSubs(mouseStopSubscribers());
    };
  }, [enabled]);
  return (
    <section className='si-panel'>
      <h2>3. "Chuột vừa dừng" (CometMouseActivity)</h2>
      <label className='switch'>
        <input type='checkbox' checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Đăng ký onMouseStop
      </label>
      <div
        className='si-pad'
        data-testid='pad'
        onMouseMove={() => {
          moveCount.current++;
          setMoves(moveCount.current);
        }}
      >
        Rê chuột trong ô này rồi dừng lại
      </div>
      <div className='stats'>
        <Stat label='mousemove' value={moves} />
        <Stat label='lần "dừng" (50ms)' value={<bdi data-testid='stops'>{stops}</bdi>} />
        <Stat label='người đăng ký' value={subs} />
      </div>
    </section>
  );
}

export default function SmallInfraDemo() {
  return (
    <div className='page'>
      <h1>Hạ tầng nhỏ: cookie, hash lỗi, chuột dừng</h1>
      <p className='hint'>Ba module vài chục dòng nhưng được gọi khắp facebook.com: CookieCore, getSimpleHash và CometMouseActivity.</p>
      <div className='si-grid'>
        <CookiePanel />
        <HashPanel />
        <MouseStopPanel />
      </div>
    </div>
  );
}

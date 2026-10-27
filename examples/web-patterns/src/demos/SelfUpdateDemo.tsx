import { useEffect, useMemo, useRef, useState } from 'react';
import {
  consumeReloadReport,
  createSelfUpdatingNavigator,
  isFullLoad,
  NavDecision,
  type UpdatePolicy,
} from '../lib/selfUpdate';
import { Log, Stat, useLog } from './shared';
import './SelfUpdateDemo.css';

const HOUR = 60 * 60 * 1000;

// App giả kiểu Trello: board, card (mở đè lên board), tìm kiếm, tài khoản, đăng nhập
const LINKS = [
  { path: '/b/roadmap', label: 'Board' },
  { path: '/c/42', label: 'Card #42' },
  { path: '/search?q=bug', label: 'Tìm kiếm' },
  { path: '/account', label: 'Tài khoản' },
  { path: '/login', label: 'Đăng nhập' },
];

function classify(path: string): string | null {
  if (path.startsWith('/b/')) return 'board';
  if (path.startsWith('/c/')) return 'card';
  if (path.startsWith('/search')) return 'search';
  if (path.startsWith('/account')) return 'account';
  if (path.startsWith('/login')) return 'auth';
  return null;
}

const LABEL: Record<NavDecision, string> = {
  FULL_LOAD_ROUTE: 'tải đầy đủ: trang không làm bằng SPA',
  PROTECTED_TRANSITION: 'SPA: chuyển cảnh board ↔ card, không reload',
  NEW_VERSION: 'reload: có bản mới',
  MAX_AGE: 'reload: app đã chạy quá lâu',
  NOT_TIME_YET: 'SPA: chưa tới lúc',
};

// sessionStorage riêng cho demo (không đụng key của app khác)
const memoryStorage = (() => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Storage;
})();

export default function SelfUpdateDemo() {
  const { lines, add } = useLog(40);
  const [maxAgeHours, setMaxAgeHours] = useState(24);
  const [path, setPath] = useState('/b/roadmap');
  const [serverVersion, setServerVersion] = useState(1);
  const skew = useRef(0); // đồng hồ demo = Date.now() + phần đã tua
  const now = () => Date.now() + skew.current;
  // mỗi lần "tải trang đầy đủ" là một lần app khởi động lại với bản mới nhất trên server
  const [boot, setBoot] = useState(() => ({ n: 1, version: 1, startedAt: now() }));
  const [, rerender] = useState(0);

  // navigator sống suốt một lần "khởi động"; các giá trị đổi được đọc qua ref
  const live = useRef({ path, maxAgeHours, serverVersion });
  live.current = { path, maxAgeHours, serverVersion };

  const nav = useMemo(() => {
    const policy: UpdatePolicy = {
      classify,
      get maxAge() {
        return live.current.maxAgeHours * HOUR;
      },
      fullLoadTypes: ['auth'],
      protectedTransitions: [
        ['board', 'card'],
        ['card', 'board'],
      ],
    };
    return createSelfUpdatingNavigator({
      policy,
      version: `v${boot.version}`,
      currentPath: () => live.current.path,
      push: (to) => setPath(to),
      fullLoad: (to) => {
        setPath(to);
        setBoot((b) => ({ n: b.n + 1, version: live.current.serverVersion, startedAt: now() }));
      },
      now,
      storage: memoryStorage,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  // server có bản mới hơn bản đang chạy: báo cho navigator
  // (thực tế: watchVersion() hỏi /version.json, hoặc server trả version trong header)
  useEffect(() => {
    if (serverVersion > boot.version) nav.markNewVersion();
  }, [nav, serverVersion, boot.version]);

  // "app vừa khởi động": đọc báo cáo reload (Trello gửi analytics ở bước này)
  useEffect(() => {
    if (boot.n === 1) return;
    const report = consumeReloadReport(memoryStorage);
    if (report) {
      add(
        `📊 analytics: reloaded { reason: ${report.reason}, ${report.fromVersion} → v${boot.version}, ${report.fromPath} → ${report.toPath}, phiên ${Math.round(report.sessionSeconds / 3600)} giờ }`,
        'ok',
      );
    } else {
      add('🌐 tải trang đầy đủ (không phải để cập nhật, không gửi analytics)', 'muted');
    }
  }, [boot, add]);

  const go = (to: string) => {
    if (to === path) return;
    const decision = nav.navigate(to);
    add(`${path} → ${to}: ${LABEL[decision]}`, isFullLoad(decision) ? 'warn' : undefined);
  };

  const age = (now() - boot.startedAt) / HOUR;

  return (
    <div className='page'>
      <h1>SPA tự cập nhật</h1>
      <p className='hint'>
        Bấm link để điều hướng. Tua đồng hồ quá {maxAgeHours} giờ hoặc deploy bản mới, rồi bấm tiếp: lần
        điều hướng kế tiếp thành tải trang đầy đủ (đúng trang vừa bấm). Riêng board ↔ card thì không
        reload; trang đăng nhập luôn tải đầy đủ.
      </p>
      <div className='toolbar'>
        <button
          onClick={() => {
            skew.current += 6 * HOUR;
            rerender((n) => n + 1);
            add('⏩ tua đồng hồ +6 giờ', 'muted');
          }}
        >
          ⏩ +6 giờ
        </button>
        <button
          onClick={() => {
            setServerVersion((v) => v + 1);
            add(`🚀 server deploy v${serverVersion + 1}`, 'muted');
          }}
        >
          🚀 Deploy bản mới
        </button>
        <label className='switch'>
          Hết hạn sau
          <select value={maxAgeHours} onChange={(e) => setMaxAgeHours(Number(e.target.value))}>
            <option value={16}>16 giờ (Zappos)</option>
            <option value={24}>24 giờ (Trello)</option>
          </select>
        </label>
      </div>
      <div className='su-app'>
        <nav className='su-nav'>
          {LINKS.map((link) => (
            <button
              key={link.path}
              className={path === link.path ? 'primary' : ''}
              onClick={() => go(link.path)}
            >
              {link.label}
            </button>
          ))}
        </nav>
        <div className='su-screen'>
          <code>{path}</code>
          <span className='muted'>loại trang: {classify(path) ?? '?'}</span>
        </div>
      </div>
      <div className='stats'>
        <Stat label='Bản đang chạy' value={`v${boot.version}`} />
        <Stat label='Bản trên server' value={`v${serverVersion}`} />
        <Stat label='App đã chạy' value={`${age.toFixed(0)} giờ`} />
        <Stat label='Số lần tải trang' value={boot.n} />
      </div>
      <Log lines={lines} />
    </div>
  );
}

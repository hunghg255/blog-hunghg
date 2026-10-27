import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  buildTransferUrl,
  createAppRegistry,
  decodeTransferParam,
  encodeTransferParam,
  isTrustedOrigin,
  listenToFrames,
  type AppStatus,
  type Lifecycles,
} from '../lib/microFrontend';
import { Log, Stat, sleep, useLog } from './shared';
import './MicroFrontendDemo.css';

const params = new URLSearchParams(location.search);
const isFrame = params.get('frame') === 'mf';

export default function MicroFrontendDemo() {
  return isFrame ? <NotificationFrame /> : <Host />;
}

// ---------------------------------------------------------------------------
// Hai "app" giả: một app kiểu cũ viết bằng DOM thuần, một app React
// ---------------------------------------------------------------------------

type Props = { log: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void; failLegacy: () => boolean };

function legacyApp(): Lifecycles<Props> {
  let timer = 0;
  let root: HTMLElement | null = null;
  return {
    async bootstrap({ log, failLegacy }) {
      await sleep(300); // tải "angular-scripts", "angular-app"
      if (failLegacy()) throw new Error('legacyBootstrap lỗi: không tải được cấu hình');
      log('[legacy] bootstrap xong (chỉ chạy một lần)', 'muted');
    },
    mount(container, { log }) {
      const el = document.createElement('div');
      el.className = 'mf-app mf-legacy';
      el.innerHTML = '<b>App cũ (kiểu AngularJS)</b><p>Bảng điều khiển · cập nhật <span>0</span> lần</p>';
      container.appendChild(el);
      root = el;
      let n = 0;
      // giống $interval: phải dọn khi unmount, nếu không vẫn chạy ngầm
      timer = window.setInterval(() => (el.querySelector('span')!.textContent = String(++n)), 500);
      log('[legacy] mount', 'ok');
    },
    unmount(_container, { log }) {
      clearInterval(timer); // tương đương $rootScope.$destroy()
      root?.remove(); // chỉ gỡ phần của mình, không xoá trắng container dùng chung
      root = null;
      log('[legacy] unmount: dọn interval + xoá DOM', 'muted');
    },
  };
}

function ReactCounter() {
  const [count, setCount] = useState(0);
  return (
    <div className='mf-app mf-react'>
      <b>App mới (React)</b>
      <p>
        Insights · <button onClick={() => setCount((c) => c + 1)}>Bấm: {count}</button>
      </p>
    </div>
  );
}

function reactApp(): Lifecycles<Props> {
  let root: ReturnType<typeof createRoot> | null = null;
  let host: HTMLElement | null = null;
  return {
    async bootstrap({ log }) {
      await sleep(200);
      log('[react] bootstrap xong', 'muted');
    },
    mount(container, { log }) {
      const el = document.createElement('div');
      container.appendChild(el);
      host = el;
      root = createRoot(el);
      root.render(<ReactCounter />);
      log('[react] mount', 'ok');
    },
    unmount(_container, { log }) {
      root?.unmount();
      root = null;
      host?.remove();
      host = null;
      log('[react] unmount (state mất, giống single-spa)', 'muted');
    },
  };
}

const ROUTES = ['/dashboard', '/websites/overview', '/sspa/insights', '/onboarding'];

// ---------------------------------------------------------------------------
// Trang chứa
// ---------------------------------------------------------------------------

function Host() {
  const { lines, add } = useLog(50);
  const legacyRef = useRef<HTMLDivElement>(null);
  const reactRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState('/dashboard');
  const [statuses, setStatuses] = useState<Record<string, AppStatus>>({});
  const failLegacy = useRef(false);
  const [failLegacyUi, setFailLegacyUi] = useState(false);
  // đổi "thế hệ" = dựng lại registry từ đầu, như tải lại trang chứa
  const [generation, setGeneration] = useState(0);

  const registry = useMemo(() => {
    const r = createAppRegistry<Props>({ log: add, failLegacy: () => failLegacy.current }, (name, status, error) => {
      setStatuses((s) => ({ ...s, [name]: status }));
      if (error) add(`[${name}] ${status}: ${(error as Error).message}`, 'err');
    });
    // Giống Similarweb: app cũ chạy ở MỌI route không chứa ripng|sspa|onboarding
    r.register({
      name: 'legacy',
      load: async () => legacyApp(),
      activeWhen: (p) => /^(?!.*(ripng|sspa|onboarding))/.test(p),
      container: () => legacyRef.current!,
    });
    r.register({
      name: 'react',
      load: async () => reactApp(),
      activeWhen: (p) => /sspa/.test(p),
      container: () => reactRef.current!,
    });
    setStatuses({});
    return r;
  }, [add, generation]);

  useEffect(() => {
    void registry.reroute(path);
  }, [registry, path]);
  useEffect(() => () => void registry.destroy(), [registry]);

  return (
    <div className='page mf'>
      <h1>Micro-frontend: mount theo route, truyền dữ liệu, nói chuyện giữa frame</h1>

      <h2>1. Hai app, một trang</h2>
      <p className='hint'>
        Mỗi app có <code>bootstrap / mount / unmount</code> và một hàm <code>activeWhen(path)</code>. Đổi route: app không
        còn khớp bị gỡ trước, app mới được tải (lần đầu) rồi gắn vào.
      </p>
      <div className='toolbar'>
        {ROUTES.map((r) => (
          <button key={r} className={r === path ? 'primary' : ''} aria-pressed={r === path} onClick={() => setPath(r)}>
            {r}
          </button>
        ))}
        <label>
          <input
            type='checkbox'
            checked={failLegacyUi}
            onChange={(e) => {
              failLegacy.current = e.target.checked;
              setFailLegacyUi(e.target.checked);
              setGeneration((g) => g + 1);
            }}
          />{' '}
          Bootstrap của app cũ lỗi (khởi động lại trang chứa)
        </label>
      </div>
      <div className='stats'>
        <Stat label='app cũ' value={statuses.legacy ?? 'not-loaded'} />
        <Stat label='app React' value={statuses.react ?? 'not-loaded'} />
      </div>
      <div className='mf-stage'>
        <div ref={legacyRef} />
        <div ref={reactRef} />
        {path === '/onboarding' && <p className='muted'>Không app nào khớp /onboarding (Similarweb để dành cho app thứ ba).</p>}
      </div>

      <TransferSection />
      <FrameSection add={add} />

      <Log lines={lines} />
    </div>
  );
}

function TransferSection() {
  const [id, setId] = useState('42');
  const [type, setType] = useState('prototype');
  const [redirectTo, setRedirectTo] = useState('/projects?filter=mine&sort=recent');

  // Kiểu InVision: btoa(JSON) rồi nối chuỗi thẳng vào URL
  const invisionData = (() => {
    try {
      return btoa(JSON.stringify({ [type]: [`${id}`] }));
    } catch (error) {
      return `(btoa lỗi: ${(error as Error).message})`;
    }
  })();
  const invisionUrl = `/teams/documents/transfer?transferDocuments=${invisionData}&redirectTo=${redirectTo}`;
  const fixedUrl = buildTransferUrl('/teams/documents/transfer', {
    transferDocuments: encodeTransferParam({ [type]: [id] }),
    redirectTo,
  });

  const read = (url: string) => {
    const q = new URL(url, location.origin).searchParams;
    return { transferDocuments: q.get('transferDocuments'), redirectTo: q.get('redirectTo'), extra: [...q.keys()].length - 2 };
  };
  const a = read(invisionUrl);
  const b = read(fixedUrl);
  let decoded = '';
  try {
    decoded = JSON.stringify(decodeTransferParam(b.transferDocuments ?? ''));
  } catch (error) {
    decoded = (error as Error).message;
  }

  return (
    <section className='card'>
      <h2>2. Truyền dữ liệu sang app khác qua URL</h2>
      <div className='toolbar'>
        <label>
          id <input value={id} onChange={(e) => setId(e.target.value)} size={10} />
        </label>
        <label>
          type <input value={type} onChange={(e) => setType(e.target.value)} size={10} />
        </label>
        <label className='mf-grow'>
          redirectTo <input value={redirectTo} onChange={(e) => setRedirectTo(e.target.value)} />
        </label>
      </div>
      <p className='hint'>Thử type "bản-thiết-kế" (có dấu) hoặc id "a?b": btoa gặp ký tự ngoài Latin-1 là ném lỗi.</p>
      <table className='mf-table'>
        <thead>
          <tr>
            <th></th>
            <th>Kiểu InVision</th>
            <th>Viết lại</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>URL</td>
            <td>
              <code>{invisionUrl}</code>
            </td>
            <td>
              <code>{fixedUrl}</code>
            </td>
          </tr>
          <tr>
            <td>Đọc lại redirectTo</td>
            <td className={a.redirectTo === redirectTo ? 'ok' : 'err'}>{a.redirectTo}</td>
            <td className={b.redirectTo === redirectTo ? 'ok' : 'err'}>{b.redirectTo}</td>
          </tr>
          <tr>
            <td>Tham số thừa</td>
            <td className={a.extra ? 'err' : 'ok'}>{a.extra}</td>
            <td className={b.extra ? 'err' : 'ok'}>{b.extra}</td>
          </tr>
          <tr>
            <td>Giải mã dữ liệu</td>
            <td colSpan={2}>
              <code>{decoded}</code>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// Các origin thử: regex của HubSpot so với isTrustedOrigin
const HUBSPOT_REGEX = /\.hubspot(qa)?\.com/;
const ORIGINS = [
  'https://app.hubspot.com',
  'https://hubspot.com',
  'http://app.hubspot.com',
  'https://app.hubspot.com.attacker.io',
  'https://evil.hubspotqa.com-login.net',
  'null',
];

function FrameSection({ add }: { add: Props['log'] }) {
  const [bell, setBell] = useState(3);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const theme = params.get('theme') ?? 'dark';

  useEffect(
    () =>
      listenToFrames(
        {
          'bell:reset': () => {
            setBell(0);
            add('Trang chứa nhận bell:reset từ iframe → đặt chuông về 0', 'ok');
          },
          'bell:set': (message) => {
            const count = Number(message.count);
            if (!Number.isInteger(count) || count < 0) return add('bell:set với count không hợp lệ: bỏ qua', 'warn');
            setBell(count);
            add(`Trang chứa nhận bell:set ${count}`, 'ok');
          },
        },
        {
          // demo chạy trên localhost/http nên so đúng origin của chính trang; site thật: isTrustedOrigin(o, 'example.com')
          isAllowed: (origin) => origin === location.origin,
          sources: () => [frameRef.current?.contentWindow ?? null],
        },
      ),
    [add],
  );

  return (
    <section className='card'>
      <h2>3. iframe thông báo nói chuyện với trang chứa</h2>
      <div className='mf-frame-row'>
        <div className='mf-bell' aria-label={`Chuông thông báo: ${bell}`}>
          🔔 <span className='badge'>{bell > 99 ? '99+' : bell}</span>
        </div>
        <iframe
          ref={frameRef}
          title='Widget thông báo'
          src={`${location.pathname}?frame=mf&theme=${theme}#/micro-frontend`}
          className='mf-iframe'
        />
      </div>
      <table className='mf-table'>
        <thead>
          <tr>
            <th>event.origin</th>
            <th>
              Regex <code>/\.hubspot(qa)?\.com/</code>
            </th>
            <th>
              <code>isTrustedOrigin(o, 'hubspot.com')</code>
            </th>
          </tr>
        </thead>
        <tbody>
          {ORIGINS.map((o) => {
            const regex = HUBSPOT_REGEX.test(o);
            const fixed = isTrustedOrigin(o, 'hubspot.com') || isTrustedOrigin(o, 'hubspotqa.com');
            return (
              <tr key={o}>
                <td>
                  <code>{o}</code>
                </td>
                <td className={regex ? 'warn' : 'muted'}>{regex ? 'cho qua' : 'chặn'}</td>
                <td className={fixed ? 'ok' : 'muted'}>{fixed ? 'cho qua' : 'chặn'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bên trong iframe
// ---------------------------------------------------------------------------

function NotificationFrame() {
  const [count, setCount] = useState(5);
  // targetOrigin = origin của trang chứa, không dùng "*": tin nhắn chỉ tới đúng nơi
  const post = (message: object) => window.parent.postMessage(JSON.stringify(message), location.origin);
  return (
    <div className='mf-child'>
      <b>Widget thông báo (iframe)</b>
      <div className='toolbar'>
        <button className='primary' onClick={() => post({ name: 'bell:reset' })}>
          Đánh dấu đã đọc hết
        </button>
        <button
          onClick={() => {
            const next = count + 1;
            setCount(next);
            post({ name: 'bell:set', count: next });
          }}
        >
          Có thông báo mới
        </button>
        <button onClick={() => post({ name: 'toString' })}>Gửi tên lạ</button>
      </div>
    </div>
  );
}

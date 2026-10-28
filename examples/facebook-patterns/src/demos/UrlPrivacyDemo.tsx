import { useEffect, useMemo, useRef, useState } from 'react';
import {
  decideClickId,
  externalLinkAttributes,
  installReferrerSwitch,
  scrubCurrentLocation,
  scrubParams,
  shimLink,
  verifyShim,
  type ClickIdPolicy,
} from '../lib/urlPrivacy';
import { Log, useLog } from './shared';
import './UrlPrivacyDemo.css';

const TOKENS = ['fb_dtsg_ag', '__md__', '__xts__', 'login_token'];
const SHIM = { endpoint: 'https://l.example.com/l.php', secret: 'demo-secret-chỉ-để-minh-hoạ' };
const POLICY: ClickIdPolicy = {
  param: 'clid',
  ownDomains: ['example.com'],
  blocklist: ['bank.example.org'],
  redirectors: [{ domain: 'ads.example.net', extract: (u) => u.searchParams.get('url') }],
};
const LINKS = [
  'https://shop.example.org/sale',
  'https://www.example.com/groups/1',
  'https://bank.example.org/login',
  'https://ads.example.net/click?url=https://bank.example.org/promo',
  'https://evilads.example.net/click?url=https://bank.example.org/promo',
  'mailto:an@example.org',
  '/relative/path',
];

function ScrubSection() {
  const [href, setHref] = useState('https://example.com/story?id=42&fb_dtsg_ag=AQx9tok&__md__=1&theme=dark#comments');
  const [current, setCurrent] = useState(() => location.href);
  let scrubbed: ReturnType<typeof scrubParams> | null = null;
  try {
    scrubbed = scrubParams(href, TOKENS);
  } catch {
    scrubbed = null;
  }

  const addToken = () => {
    const url = new URL(location.href);
    url.searchParams.set('login_token', 'demo123');
    history.replaceState(history.state, '', url);
    setCurrent(location.href);
  };
  const scrub = () => {
    scrubCurrentLocation(TOKENS);
    setCurrent(location.href);
  };

  return (
    <section className='card'>
      <h2>1. Xoá token khỏi URL</h2>
      <input type='text' value={href} onChange={(e) => setHref(e.target.value)} aria-label='URL có token' spellCheck={false} />
      <p className='up-out' data-testid='scrubbed'>
        {scrubbed ? scrubbed.url : 'URL không hợp lệ'}
        {scrubbed && scrubbed.removed.length > 0 && <span className='ok'> (bỏ {scrubbed.removed.join(', ')})</span>}
      </p>
      <div className='toolbar'>
        <button onClick={addToken}>Thêm login_token vào thanh địa chỉ</button>
        <button onClick={scrub}>replaceState làm sạch</button>
      </div>
      <p className='up-out muted' data-testid='location'>
        {current}
      </p>
    </section>
  );
}

function ShimSection() {
  const [target, setTarget] = useState('https://shop.example.org/sale?item=7');
  const [shimmed, setShimmed] = useState('');
  const [verdict, setVerdict] = useState<{ ok: string | null; tampered: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const once = await shimLink(target, SHIM);
        const twice = await shimLink(once, SHIM); // bọc lại link đã bọc: không lồng hai lớp
        const tampered = new URL(twice);
        tampered.searchParams.set('u', 'https://evil.example.net/phish');
        const result = { ok: await verifyShim(twice, SHIM), tampered: await verifyShim(tampered.toString(), SHIM) };
        if (alive) {
          setShimmed(twice);
          setVerdict(result);
        }
      } catch {
        if (alive) {
          setShimmed('URL không hợp lệ');
          setVerdict(null);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [target]);

  return (
    <section className='card'>
      <h2>2. Link shim có chữ ký</h2>
      <input type='text' value={target} onChange={(e) => setTarget(e.target.value)} aria-label='Link đích' spellCheck={false} />
      <p className='up-out' data-testid='shimmed'>
        {shimmed}
      </p>
      {verdict && (
        <ul className='up-list'>
          <li className={verdict.ok ? 'ok' : 'err'} data-testid='verify-ok'>
            chữ ký khớp → chuyển tới {verdict.ok ?? '(từ chối)'}
          </li>
          <li className={verdict.tampered ? 'err' : 'ok'} data-testid='verify-tampered'>
            sửa <code>u</code> thành trang lừa đảo → {verdict.tampered ?? 'từ chối (chữ ký không khớp)'}
          </li>
        </ul>
      )}
    </section>
  );
}

function ClickIdSection() {
  const rows = useMemo(() => LINKS.map((href) => ({ href, d: decideClickId(href, 'IwAR0demo', POLICY) })), []);
  return (
    <section className='card'>
      <h2>3. Gắn tham số đo lường hay không?</h2>
      <p className='muted up-small'>
        Chính sách: nội bộ <code>example.com</code>, blocklist <code>bank.example.org</code>, ad redirect{' '}
        <code>ads.example.net</code>.
      </p>
      <table className='up-table'>
        <tbody>
          {rows.map(({ href, d }) => (
            <tr key={href}>
              <td>
                <code>{href}</code>
              </td>
              <td className={d.decorate ? 'warn' : 'muted'} data-testid='clid'>
                {d.decorate ? '+ clid' : d.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ReferrerSection() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [withAux, setWithAux] = useState(true);
  const { lines, add } = useLog(20);

  useEffect(() => {
    const root = rootRef.current!;
    // thẻ meta riêng cho demo, gỡ khi rời trang
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'unsafe-url';
    document.head.append(meta);
    const mo = new MutationObserver(() => add(`meta referrer = ${meta.content}`, meta.content === 'origin' ? 'ok' : undefined));
    mo.observe(meta, { attributes: true, attributeFilter: ['content'] });
    const off = installReferrerSwitch(root, meta, { switched: 'origin', events: withAux ? ['click', 'auxclick'] : ['click'] });
    // demo không thật sự điều hướng
    const stop = (e: Event) => {
      if ((e.target as Element).closest('a')) {
        e.preventDefault();
        add(`${e.type} (${(e as MouseEvent).button === 1 ? 'chuột giữa' : 'chuột trái'}) → mở link`);
      }
    };
    root.addEventListener('click', stop);
    root.addEventListener('auxclick', stop);
    return () => {
      off();
      mo.disconnect();
      root.removeEventListener('click', stop);
      root.removeEventListener('auxclick', stop);
      meta.remove();
    };
  }, [withAux, add]);

  const attrs = externalLinkAttributes('origin');
  return (
    <section className='card'>
      <h2>4. Referer khi rời trang</h2>
      <p className='muted up-small'>
        Trang để <code>unsafe-url</code> (gửi cả đường dẫn). Bấm link: thẻ meta đổi tạm sang <code>origin</code> rồi trả lại
        sau 100ms. Thử bấm chuột giữa.
      </p>
      <label className='switch'>
        <input type='checkbox' checked={withAux} onChange={(e) => setWithAux(e.target.checked)} /> nghe cả auxclick (bản gốc
        chỉ nghe click)
      </label>
      <div ref={rootRef} className='up-links'>
        <a href='https://shop.example.org/' data-ref-mode='origin' data-testid='ref-link'>
          shop.example.org (đổi meta)
        </a>
        <a href='https://shop.example.org/' {...attrs}>
          referrerPolicy=&quot;origin&quot; trên thẻ a
        </a>
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function UrlPrivacyDemo() {
  return (
    <div className='page up'>
      <h1>URL, link ra ngoài và quyền riêng tư</h1>
      <p className='hint'>Bốn lớp nhỏ: xoá token khỏi thanh địa chỉ, link shim có chữ ký, quyết định gắn click id, giới hạn Referer.</p>
      <div className='up-grid'>
        <ScrubSection />
        <ShimSection />
        <ClickIdSection />
        <ReferrerSection />
      </div>
    </div>
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cancelOnUserScroll, createScrollHistory, focusFirstReachable, type RestoreResult } from '../lib/tryScroll';
import { Log, useLog } from './shared';
import './TryScrollDemo.css';

const TOTAL = 120;
const ROW_HEIGHT = 48;
const NAMES = ['Tai nghe', 'Bàn phím', 'Chuột', 'Màn hình', 'Loa', 'Webcam', 'Ổ cứng', 'Sạc nhanh', 'Giá đỡ', 'Hub USB-C'];

type Mode = 'naive' | 'try';
type Page = { page: 'list' } | { page: 'detail'; item: number };

// ---------- phần 1: khôi phục vị trí cuộn ----------

/** Trang danh sách "tải dần": 10 dòng ngay, mỗi chunkMs thêm 15 dòng, giống dữ liệu về theo đợt + lazy render. */
function ProductList({ chunkMs, onCount, onOpen }: { chunkMs: number; onCount: (n: number) => void; onOpen: (i: number) => void }) {
  const [count, setCount] = useState(10);
  useEffect(() => {
    const timer = setInterval(() => {
      setCount((c) => {
        const next = Math.min(TOTAL, c + 15);
        if (next >= TOTAL) clearInterval(timer);
        return next;
      });
    }, chunkMs);
    return () => clearInterval(timer);
  }, [chunkMs]);
  useEffect(() => onCount(count), [count, onCount]);
  return (
    <ul className='ts-list'>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} style={{ height: ROW_HEIGHT }}>
          <button onClick={() => onOpen(i)} data-item={i}>
            <span className='ts-index'>#{i + 1}</span> {NAMES[i % NAMES.length]} {i + 1}
          </button>
        </li>
      ))}
      {count < TOTAL && <li className='ts-loading'>Đang tải thêm…</li>}
    </ul>
  );
}

function ScrollRestoreDemo() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<Page>({ page: 'list' });
  const [count, setCount] = useState(10);
  const [visit, setVisit] = useState(0);
  const [mode, setMode] = useState<Mode>('try');
  const [chunkMs, setChunkMs] = useState(120);
  const [timeout, setTimeoutMs] = useState(1600);
  const [restoreTo, setRestoreTo] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const { lines, add } = useLog(10);
  const settingsRef = useRef({ mode, timeout });
  settingsRef.current = { mode, timeout };
  // vị trí lúc rời danh sách, chỉ để cách ngây thơ dùng và để hiển thị (cách của Apple đọc từ createScrollHistory)
  const savedRef = useRef(0);

  const hist = useMemo(() => createScrollHistory(() => viewportRef.current), []);

  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = (event.state ?? {}) as Partial<Page> & { scrollId?: string };
      if (state.page === 'detail' && typeof (state as { item?: number }).item === 'number') {
        setPage({ page: 'detail', item: (state as { item: number }).item });
        return;
      }
      setPage({ page: 'list' });
      setVisit((v) => v + 1); // mỗi lần quay lại là một lần render danh sách mới, bắt đầu từ 10 dòng
      setRestoreTo(Date.now()); // báo cho effect bên dưới: render xong trang danh sách thì khôi phục
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Khôi phục sau khi React đã render trang danh sách (10 dòng đầu)
  useLayoutEffect(() => {
    if (restoreTo === null || page.page !== 'list') return;
    const viewport = viewportRef.current!;
    const { mode: currentMode, timeout: currentTimeout } = settingsRef.current;
    if (currentMode === 'naive') {
      const before = viewport.scrollHeight;
      // cách ngây thơ: đặt scrollTop ngay, trình duyệt kẹp về tối đa scrollHeight - clientHeight
      const saved = savedRef.current;
      viewport.scrollTop = saved;
      const msg = `Đặt scrollTop = ${saved} khi trang mới cao ${before}px → thực tế ${Math.round(viewport.scrollTop)}`;
      setStatus(msg);
      add(msg, Math.abs(viewport.scrollTop - saved) > 2 ? 'err' : 'ok');
    } else {
      const started = performance.now();
      let waited = 0;
      const userScroll = cancelOnUserScroll(viewport);
      void hist
        .restore({
          timeout: currentTimeout,
          signal: userScroll.signal,
          onWait: ({ frame }) => {
            waited = frame;
          },
        })
        .then((result: RestoreResult) => {
          userScroll.abort();
          const ms = Math.round(performance.now() - started);
          const msg =
            result === 'restored'
              ? `Khôi phục ${Math.round(viewport.scrollTop)}px sau ${waited} frame chờ (${ms} ms)`
              : result === 'gave-up'
                ? `Bỏ cuộc sau ${ms} ms: trang chưa đủ cao`
                : result === 'cancelled'
                  ? 'Người dùng tự cuộn: huỷ khôi phục'
                  : 'Không có vị trí đã lưu';
          setStatus(msg);
          add(msg, result === 'restored' ? 'ok' : 'warn');
        });
    }
    setRestoreTo(null);
  }, [restoreTo, page, hist, add]);

  const openDetail = (item: number) => {
    savedRef.current = viewportRef.current?.scrollTop ?? 0;
    add(`Rời danh sách ở ${Math.round(savedRef.current)}px, mở "${NAMES[item % NAMES.length]} #${item + 1}"`, 'muted');
    hist.push({ page: 'detail', item });
    setPage({ page: 'detail', item });
  };

  return (
    <section className='card ts-panel'>
      <h2>1. Back về danh sách đang tải dần</h2>
      <div className='toolbar'>
        <label>
          Cách khôi phục{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value='try'>Chờ trang đủ cao (Apple)</option>
            <option value='naive'>Đặt scrollTop ngay</option>
          </select>
        </label>
        <label>
          Mỗi đợt dữ liệu{' '}
          <select value={chunkMs} onChange={(e) => setChunkMs(Number(e.target.value))}>
            <option value={40}>40 ms</option>
            <option value={120}>120 ms</option>
            <option value={400}>400 ms (mạng chậm)</option>
          </select>
        </label>
        <label>
          Chờ tối đa{' '}
          <select value={timeout} onChange={(e) => setTimeoutMs(Number(e.target.value))}>
            <option value={800}>800 ms (100 frame ở 120Hz)</option>
            <option value={1600}>1600 ms (100 frame ở 60Hz)</option>
            <option value={4000}>4000 ms</option>
          </select>
        </label>
      </div>
      <div className='stats'>
        <div className='stat'>
          <b>{page.page === 'list' ? `${count}/${TOTAL}` : '—'}</b>
          <span>dòng đã render</span>
        </div>
        <div className='stat'>
          <b data-testid='saved-y'>{Math.round(savedRef.current)}</b>
          <span>vị trí đã lưu (px)</span>
        </div>
      </div>
      <p className='hint' data-testid='restore-status'>
        {status || 'Cuộn xuống khoảng giữa danh sách, bấm một sản phẩm, rồi bấm "← Quay lại".'}
      </p>
      <div ref={viewportRef} className='ts-viewport' data-testid='viewport'>
        {page.page === 'list' ? (
          <ProductList key={visit} chunkMs={chunkMs} onCount={setCount} onOpen={openDetail} />
        ) : (
          <div className='ts-detail'>
            <button className='primary' onClick={() => history.back()} data-testid='back'>
              ← Quay lại
            </button>
            <h3>
              {NAMES[page.item % NAMES.length]} {page.item + 1}
            </h3>
            <p className='hint'>Trang chi tiết ngắn. Nút Back của trình duyệt cũng dùng được (demo dùng history thật).</p>
          </div>
        )}
      </div>
      <Log lines={lines} />
    </section>
  );
}

// ---------- phần 2: skip link ----------

type Variant = 'hidden-first' | 'no-focusable';

function describe(el: Element | null) {
  if (!el || el === document.body) return '<body> (focus bị mất)';
  const tag = el.tagName.toLowerCase();
  const text = (el.textContent ?? '').trim().slice(0, 30);
  return `<${tag}>${text ? ` "${text}"` : ''}${el.id ? ` #${el.id}` : ''}`;
}

function SkipLinkDemo() {
  const mainRef = useRef<HTMLElement>(null);
  const [variant, setVariant] = useState<Variant>('hidden-first');
  const [result, setResult] = useState<{ naive: string; verified: string }>({ naive: '', verified: '' });

  const runNaive = (event: React.MouseEvent) => {
    event.preventDefault();
    const main = mainRef.current!;
    main.removeAttribute('tabindex');
    // cách ngây thơ: lấy phần tử "focus được" đầu tiên theo selector rồi focus
    const first = main.querySelector<HTMLElement>('a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])');
    first?.focus();
    setResult((r) => ({ ...r, naive: describe(document.activeElement) }));
  };
  const runVerified = (event: React.MouseEvent) => {
    event.preventDefault();
    mainRef.current!.removeAttribute('tabindex');
    focusFirstReachable(mainRef.current!);
    setResult((r) => ({ ...r, verified: describe(document.activeElement) }));
  };

  return (
    <section className='card ts-panel'>
      <h2>2. Skip link: focus phải thật sự tới nơi (Zappos)</h2>
      <div className='toolbar'>
        <label>
          Nội dung chính{' '}
          <select value={variant} onChange={(e) => setVariant(e.target.value as Variant)}>
            <option value='hidden-first'>Phần tử đầu bị ẩn / nằm trong vùng inert</option>
            <option value='no-focusable'>Không có gì focus được</option>
          </select>
        </label>
      </div>
      <div className='ts-site'>
        <nav className='ts-nav' aria-label='Menu mẫu'>
          <a href='#skip-main' className='ts-skip' onClick={runNaive} data-testid='skip-naive'>
            Bỏ qua tới nội dung (ngây thơ)
          </a>
          <a href='#skip-main' className='ts-skip' onClick={runVerified} data-testid='skip-verified'>
            Bỏ qua tới nội dung (kiểm tra activeElement)
          </a>
          {['Nữ', 'Nam', 'Trẻ em', 'Giày chạy', 'Khuyến mãi', 'Thương hiệu'].map((label) => (
            <a key={label} href='#nav'>
              {label}
            </a>
          ))}
        </nav>
        <main id='skip-main' ref={mainRef} className='ts-main'>
          {variant === 'hidden-first' ? (
            <>
              <button className='ts-hidden-button'>Nút chỉ hiện trên mobile (display: none)</button>
              <div inert>
                <a href='#x'>Banner đang đóng (inert)</a>
              </div>
              <h3>Giày chạy bộ nam</h3>
              <a href='#p1' id='first-product'>
                Sản phẩm đầu tiên
              </a>{' '}
              · <a href='#p2'>Sản phẩm thứ hai</a>
            </>
          ) : (
            <>
              <h3>Chính sách đổi trả</h3>
              <p>Đoạn văn bản thuần, không có link hay nút nào.</p>
            </>
          )}
        </main>
      </div>
      <div className='split ts-results'>
        <div>
          <div className='ts-label'>Ngây thơ: focus vào</div>
          <code data-testid='naive-result'>{result.naive || '—'}</code>
        </div>
        <div>
          <div className='ts-label'>focusFirstReachable: focus vào</div>
          <code data-testid='verified-result'>{result.verified || '—'}</code>
        </div>
      </div>
    </section>
  );
}

export default function TryScrollDemo() {
  return (
    <div className='page try-scroll-demo'>
      <h1>Khôi phục vị trí cuộn và skip link</h1>
      <p className='hint'>Back về một trang còn đang tải dần, và nhảy focus tới nội dung chính sao cho chắc chắn tới nơi.</p>
      <ScrollRestoreDemo />
      <SkipLinkDemo />
    </div>
  );
}

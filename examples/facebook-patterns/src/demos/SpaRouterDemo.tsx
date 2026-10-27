import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRouter, hardNavigate, type Router, type RouterEvent } from '../lib/routerHygiene';
import { Log, Stat, useLog } from './shared';

const PAGES: Record<string, string> = {
  '/': 'Trang chủ',
  '/photos': 'Ảnh',
  '/compose': 'Soạn bài',
};
const MAX_NAVIGATIONS = 5; // Facebook: 50, demo để 5 cho dễ thử
const RELOAD_NOTE_KEY = 'spa-router-demo:reload';

/** URL của "trang" trong demo: giữ nguyên path + hash của demo, trang nằm trong ?page= */
function urlFor(page: string) {
  const params = new URLSearchParams(location.search);
  params.set('page', page);
  return `${location.pathname}?${params}${location.hash}`;
}
const pageOf = (url: string) => new URL(url, location.href).searchParams.get('page') ?? '/';

const DAY = 24 * 60 * 60 * 1000;

function describe(event: RouterEvent) {
  switch (event.type) {
    case 'navigate':
      return `${event.replace ? 'replace' : 'push'} → ${pageOf(event.url)}`;
    case 'popstate':
      return `popstate → ${pageOf(event.url)}`;
    case 'unknown_key':
      return `popstate với key lạ → dựng lại từ URL ${pageOf(event.url)}`;
    case 'force_reload':
      return `⚠️ reload đầy đủ (${event.reason}) → ${pageOf(event.url)}`;
    case 'blocked':
      return `✋ unload hook chặn: "${event.message}"`;
    case 'back_no_history':
      return `back: không có lịch sử trong app → ${pageOf(event.fallbackUrl)}`;
    case 'back_failed':
      return `back: hết ${500}ms không thấy popstate → ${pageOf(event.fallbackUrl)}`;
  }
}

export default function SpaRouterDemo() {
  const { lines, add } = useLog();
  const timeOffsetRef = useRef(0);
  const [router, setRouter] = useState<Router | null>(null);
  const [ask, setAsk] = useState<{ message: string; resolve: (leave: boolean) => void } | null>(null);
  const [draft, setDraft] = useState('');
  const [reloadNote] = useState(() => {
    try {
      const note = sessionStorage.getItem(RELOAD_NOTE_KEY);
      sessionStorage.removeItem(RELOAD_NOTE_KEY);
      return note;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const r = createRouter({
      maxNavigations: MAX_NAVIGATIONS,
      now: () => Date.now() + timeOffsetRef.current,
      onEvent: (event) => add(describe(event), event.type === 'force_reload' ? 'warn' : undefined),
      // Hộp thoại trong app thay cho window.confirm (Facebook cũng hiện dialog riêng).
      confirmLeave: (message) => new Promise((resolve) => setAsk({ message, resolve })),
      forceReload: (url, reason) => {
        try {
          sessionStorage.setItem(RELOAD_NOTE_KEY, reason);
        } catch {
          /* chế độ ẩn danh chặn storage: vẫn reload */
        }
        hardNavigate(url);
      },
    });
    setRouter(r);
    return () => r.destroy();
  }, [add]);

  if (!router) return null;
  return (
    <RouterView
      router={router}
      reloadNote={reloadNote}
      draft={draft}
      setDraft={setDraft}
      timeOffsetRef={timeOffsetRef}
      lines={lines}
      ask={ask}
      closeAsk={(leave) => {
        ask?.resolve(leave);
        setAsk(null);
      }}
    />
  );
}

function RouterView({
  router,
  reloadNote,
  draft,
  setDraft,
  timeOffsetRef,
  lines,
  ask,
  closeAsk,
}: {
  router: Router;
  reloadNote: string | null;
  draft: string;
  setDraft: (value: string) => void;
  timeOffsetRef: { current: number };
  lines: ReturnType<typeof useLog>['lines'];
  ask: { message: string } | null;
  closeAsk: (leave: boolean) => void;
}) {
  const snap = useSyncExternalStore(router.subscribe, router.getSnapshot);
  const page = pageOf(snap.url);
  const [daysAhead, setDaysAhead] = useState(0);

  // Trang soạn bài có nội dung chưa đăng -> chặn rời trang (cả nút Back của trình duyệt).
  useEffect(() => {
    if (page !== '/compose' || !draft.trim()) return;
    return router.addUnloadHook(() => 'Bài viết của bạn chưa được đăng. Rời trang?');
  }, [router, page, draft]);

  return (
    <div className='page'>
      <h1>Router SPA "sạch sẽ"</h1>
      <p className='hint'>
        Sau {MAX_NAVIGATIONS} lần điều hướng, hoặc khi phiên quá 2.5 ngày, hoặc có bản deploy mới,
        lần điều hướng kế tiếp sẽ là một lần tải lại đầy đủ. Mở demo ở trang đầu rồi bấm "Quay lại":
        không có lịch sử nên router đưa về trang chủ thay vì rời app.
      </p>
      {reloadNote && (
        <div className='card' style={{ marginBottom: 12, borderColor: 'var(--warn)' }} data-testid='reload-note'>
          Trang vừa được tải lại đầy đủ vì: <b>{reloadNote}</b>
        </div>
      )}
      <div className='toolbar'>
        {Object.entries(PAGES).map(([path, label]) => (
          <button
            key={path}
            className={path === page ? 'primary' : undefined}
            onClick={() => router.navigate(urlFor(path))}
          >
            {label}
          </button>
        ))}
        <button onClick={() => router.back(urlFor('/'))}>← Quay lại</button>
      </div>
      <div className='toolbar'>
        <button onClick={() => router.markNewVersionAvailable()}>Giả lập deploy mới</button>
        <button
          onClick={() => {
            timeOffsetRef.current += 3 * DAY;
            setDaysAhead((d) => d + 3);
          }}
        >
          Tua thời gian +3 ngày
        </button>
      </div>
      <div className='stats'>
        <Stat label='trang hiện tại' value={<output data-testid='page'>{PAGES[page] ?? page}</output>} />
        <Stat label='vị trí lịch sử (index)' value={<output data-testid='index'>{snap.index}</output>} />
        <Stat
          label='số lần điều hướng'
          value={<output data-testid='count'>{`${snap.navigationCount}/${MAX_NAVIGATIONS}`}</output>}
        />
        <Stat label='bản mới / tua giờ' value={`${snap.newVersionAvailable ? 'có' : 'không'} / +${daysAhead}d`} />
      </div>
      <div className='split'>
        <div className='card'>
          <b>{PAGES[page] ?? page}</b>
          {page === '/compose' ? (
            <textarea
              aria-label='Nội dung bài viết'
              placeholder='Gõ gì đó rồi thử chuyển trang hoặc bấm Back của trình duyệt'
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ display: 'block', width: '100%', minHeight: 90, marginTop: 8, font: 'inherit', padding: 8, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
            />
          ) : (
            <p className='muted' style={{ margin: '8px 0 0' }}>
              history.state chỉ chứa {'{ key, index }'}; nội dung trang nằm trong bộ nhớ của router.
            </p>
          )}
        </div>
        <Log lines={lines} />
      </div>
      {ask && (
        <div className='backdrop'>
          <div className='dialog' role='alertdialog' aria-modal='true' aria-label='Rời khỏi trang?'>
            <h2>Rời khỏi trang?</h2>
            <p className='muted' style={{ margin: 0 }}>
              {ask.message}
            </p>
            <div className='toolbar' style={{ margin: 0 }}>
              <button className='primary' onClick={() => closeAsk(true)}>
                Rời khỏi trang
              </button>
              <button onClick={() => closeAsk(false)}>Ở lại trang</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

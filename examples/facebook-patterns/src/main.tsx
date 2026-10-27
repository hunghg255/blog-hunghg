import { StrictMode, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// Mỗi demo là một route dạng hash (#/ten-demo) để bản build chạy được trên mọi static host
// và blog có thể nhúng từng demo bằng <iframe src=".../#/ten-demo">.
const demos = {
  'shared-intersection-observer': {
    title: 'Shared IntersectionObserver',
    desc: 'Hàng trăm element, một observer',
    component: lazy(() => import('./demos/SharedObserverDemo')),
  },
  'infinite-scroll': {
    title: 'Infinite scroll',
    desc: 'Sentinel + chống gọi API trùng',
    component: lazy(() => import('./demos/InfiniteScrollDemo')),
  },
  'viewport-duration': {
    title: 'useViewportDuration',
    desc: 'Đo thời gian bài viết thực sự được xem',
    component: lazy(() => import('./demos/ViewportDurationDemo')),
  },
  'preload-on-hover': {
    title: 'Preload khi hover',
    desc: 'Tải trước code + data trước khi click',
    component: lazy(() => import('./demos/PreloadDemo')),
  },
  toaster: {
    title: 'Toast manager',
    desc: 'External store, hàng đợi, dừng khi hover',
    component: lazy(() => import('./demos/ToastDemo')),
  },
  'network-status': {
    title: 'Network status + heartbeat',
    desc: 'Exponential backoff, không tin navigator.onLine',
    component: lazy(() => import('./demos/NetworkStatusDemo')),
  },
  'error-guard': {
    title: 'ErrorGuard',
    desc: 'Bắt lỗi theo ngữ cảnh, chung một pipeline',
    component: lazy(() => import('./demos/ErrorGuardDemo')),
  },
  'batch-logger': {
    title: 'Batch logger',
    desc: 'Gom log, ưu tiên, sendBeacon',
    component: lazy(() => import('./demos/BatchLoggerDemo')),
  },
  'focus-trap': {
    title: 'Focus trap',
    desc: 'Giữ focus trong dialog, Esc theo layer',
    component: lazy(() => import('./demos/FocusTrapDemo')),
  },
} as const;

type DemoKey = keyof typeof demos;

function getRoute(): DemoKey | null {
  const key = window.location.hash.replace(/^#\/?/, '');
  return key in demos ? (key as DemoKey) : null;
}

const theme = new URLSearchParams(window.location.search).get('theme');
if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;

// Khi nằm trong iframe của blog thì ẩn link quay lại danh sách.
const embedded = window.self !== window.top;

function App() {
  const [route, setRoute] = useState(getRoute);

  useEffect(() => {
    const onHashChange = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  if (!route) {
    return (
      <div className='page'>
        <h1>Học từ mã nguồn Facebook</h1>
        <p className='hint'>Các demo đi kèm loạt bài trên blog.hunghg.me</p>
        <ul className='index-list'>
          {Object.entries(demos).map(([key, demo]) => (
            <li key={key}>
              <a href={`#/${key}`}>
                {demo.title}
                <small>{demo.desc}</small>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const Demo = demos[route].component;
  return (
    <>
      {!embedded && (
        <div className='page' style={{ paddingBottom: 0 }}>
          <a className='back' href='#/'>
            ← Tất cả demo
          </a>
        </div>
      )}
      <Suspense
        fallback={
          <div className='page'>
            <span className='spinner' />
          </div>
        }
      >
        <Demo />
      </Suspense>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { StrictMode, lazy, Suspense, useEffect, useState, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import type { DemoRegistration } from './demoRegistry';

// Mỗi demo là một route dạng hash (#/ten-demo), tự đăng ký bằng một file nhỏ trong
// demos/registry/ (chỉ metadata), còn code demo được tách chunk và tải lười qua `load`.
interface DemoEntry {
  title: string;
  desc: string;
  component: ComponentType;
}

const registrations = Object.values(
  import.meta.glob<DemoRegistration>('./demos/registry/*.ts', { eager: true, import: 'default' }),
).sort((a, b) => a.order - b.order);

const demos: Record<string, DemoEntry> = {};
for (const r of registrations) {
  demos[r.route] = { title: r.title, desc: r.desc, component: lazy(r.load) };
}

function getRoute(): string | null {
  const key = window.location.hash.replace(/^#\/?/, '');
  return key in demos ? key : null;
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
        <h1>Học từ mã nguồn các web lớn</h1>
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

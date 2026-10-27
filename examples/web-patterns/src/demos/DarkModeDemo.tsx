import { useEffect, useMemo, useState } from 'react';
import { themeInitScript } from '../lib/themeScript';
import { createThemeStore, useTheme } from '../lib/themeStore';
import { Log, useLog } from './shared';
import './DarkModeDemo.css';

const STORAGE_KEY = 'wp-demo-theme';
const HYDRATE_DELAY = 800; // giả lập thời gian tải + chạy bundle JS

const PAGE_CSS = `
  :root { --bg: #ffffff; --text: #1d1d24; --card: #f1f1f5; }
  :root[data-theme='dark'] { --bg: #111117; --text: #ececf1; --card: #23232c; }
  body { margin: 0; padding: 14px; font: 14px/1.5 system-ui, sans-serif; background: var(--bg); color: var(--text); }
  .bar { height: 12px; border-radius: 6px; background: var(--card); margin: 8px 0; }
  .bar.short { width: 60%; }
  h3 { margin: 0 0 6px; font-size: 15px; }
`;

/** Trang giả lập. `strategy` quyết định theme được áp lúc nào. */
function buildPage(strategy: 'naive' | 'script', id: string) {
  const report = `function report(kind){ parent.postMessage({ demo: 'dark-mode', id: '${id}', kind: kind,
    theme: document.documentElement.getAttribute('data-theme') || 'light', t: Math.round(performance.now()) }, '*'); }`;
  const head =
    strategy === 'script'
      ? `<script>${themeInitScript({ storageKey: STORAGE_KEY })}</script>`
      : '';
  const tail =
    strategy === 'naive'
      ? // Cách ngây thơ: đợi "React hydrate" xong mới đọc localStorage rồi đổi theme
        `<script>${report}
          requestAnimationFrame(function(){ report('first-frame'); });
          setTimeout(function(){
            var t = localStorage.getItem('${STORAGE_KEY}');
            if (!t) t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', t);
            report('applied');
          }, ${HYDRATE_DELAY});
        </script>`
      : // Theme đã đúng từ <head>; chỉ cần nghe tab/khung khác đổi theme để cập nhật
        `<script>${report}
          requestAnimationFrame(function(){ report('first-frame'); });
          addEventListener('storage', function(e){
            if (e.key !== '${STORAGE_KEY}' && e.key !== null) return;
            ${themeInitScript({ storageKey: STORAGE_KEY })};
            report('synced');
          });
        </script>`;
  return `<!doctype html><html><head><meta charset="utf-8">${head}<style>${PAGE_CSS}</style></head>
    <body><h3>${strategy === 'naive' ? 'Áp theme sau khi hydrate' : 'Script chặn trong &lt;head&gt;'}</h3>
    <div class="bar"></div><div class="bar short"></div><div class="bar"></div><div class="bar short"></div>
    ${tail}</body></html>`;
}

interface FrameState {
  first?: string;
  applied?: string;
}

export default function DarkModeDemo() {
  const store = useMemo(() => createThemeStore(STORAGE_KEY, 'data-demo-theme'), []);
  useEffect(() => () => store.destroy(), [store]);
  const { preference, resolved, setPreference } = useTheme(store);
  const [reloadKey, setReloadKey] = useState(0);
  const [frames, setFrames] = useState<Record<string, FrameState>>({});
  const log = useLog();

  const pages = useMemo(
    () => ({ naive: buildPage('naive', 'naive'), script: buildPage('script', 'script') }),
    [],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.demo !== 'dark-mode') return;
      const name = data.id === 'naive' ? 'Ngây thơ' : 'Script chặn';
      if (data.kind === 'first-frame') {
        setFrames((prev) => ({ ...prev, [data.id]: { first: data.theme } }));
        log.add(`${name}: frame đầu tiên vẽ màu ${data.theme === 'dark' ? 'TỐI' : 'SÁNG'}`, 'muted');
      } else {
        setFrames((prev) => ({ ...prev, [data.id]: { ...prev[data.id], applied: data.theme } }));
        log.add(
          data.kind === 'applied'
            ? `${name}: ${data.t}ms mới đổi sang ${data.theme}`
            : `${name}: nhận sự kiện storage, đổi sang ${data.theme} không cần tải lại`,
          data.kind === 'applied' ? 'warn' : 'ok',
        );
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [log.add]);

  const verdict = (id: 'naive' | 'script') => {
    const f = frames[id];
    if (!f?.first) return <span className='muted'>đang tải…</span>;
    if (f.first === resolved) return <span className='badge ok'>Frame đầu đã đúng màu</span>;
    return <span className='badge err'>Nháy: frame đầu {f.first === 'dark' ? 'tối' : 'sáng'}</span>;
  };

  return (
    <div className='page'>
      <h1>Dark mode không nháy</h1>
      <p className='hint'>
        Chọn theme rồi bấm <b>Tải lại 2 trang</b>. Trang trái đợi {HYDRATE_DELAY}ms (giả lập bundle JS) mới áp
        theme nên bị nháy. Trang phải có script chặn trong <code>&lt;head&gt;</code>.
      </p>
      <div className='toolbar' role='group' aria-label='Chọn theme'>
        {(['light', 'dark', 'system'] as const).map((p) => (
          <button key={p} className={preference === p ? 'primary' : ''} aria-pressed={preference === p} onClick={() => setPreference(p)}>
            {p === 'light' ? '☀️ Sáng' : p === 'dark' ? '🌙 Tối' : '💻 Theo hệ thống'}
          </button>
        ))}
        <button onClick={() => { setFrames({}); setReloadKey((k) => k + 1); }}>↻ Tải lại 2 trang</button>
      </div>
      <p className='hint'>
        Đang chọn <b>{preference}</b> → áp dụng <b>{resolved}</b>.
      </p>
      <div className='dm-frames'>
        {(['naive', 'script'] as const).map((id) => (
          <figure key={id}>
            <iframe key={`${id}-${reloadKey}`} title={id} srcDoc={pages[id]} />
            <figcaption>
              {id === 'naive' ? 'Cách ngây thơ' : 'Script chặn (Gatsby/theme-ui)'} · {verdict(id)}
            </figcaption>
          </figure>
        ))}
      </div>
      <Log lines={log.lines} />
    </div>
  );
}

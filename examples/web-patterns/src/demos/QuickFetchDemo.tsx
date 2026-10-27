import { useEffect, useRef, useState } from 'react';
import { createQuickFetch, withQuickFetch } from '../lib/quickFetch';
import { Log, Stat, sleep, useLog } from './shared';
import './QuickFetchDemo.css';

interface Bar {
  label: string;
  start: number;
  end?: number;
  tone: 'bundle' | 'api' | 'early' | 'err';
}

const RECORD_ID = '0-1';

export default function QuickFetchDemo() {
  const [bundleMs, setBundleMs] = useState(1400);
  const [apiMs, setApiMs] = useState(900);
  const [failEarly, setFailEarly] = useState(false);
  const [navigated, setNavigated] = useState(false);
  const [bars, setBars] = useState<Bar[]>([]);
  const [now, setNow] = useState(0);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<{ normal?: number; quick?: number }>({});
  const log = useLog();
  const t0 = useRef(0);

  // đồng hồ cho các thanh đang chạy
  useEffect(() => {
    if (!running) return;
    let id = 0;
    const tick = () => {
      setNow(performance.now() - t0.current);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running]);

  const run = async (mode: 'normal' | 'quick') => {
    setRunning(true);
    setBars([]);
    log.clear();
    t0.current = performance.now();
    const at = () => Math.round(performance.now() - t0.current);
    const list: Bar[] = [];
    const push = (bar: Bar) => {
      list.push(bar);
      setBars([...list]);
      return bar;
    };
    const finish = (bar: Bar, tone?: Bar['tone']) => {
      bar.end = at();
      if (tone) bar.tone = tone;
      setBars([...list]);
    };

    let calls = 0;
    // API giả: lần gọi đầu có thể lỗi nếu bật "request sớm lỗi"
    const fakeApi = async (url: string) => {
      const isEarly = mode === 'quick' && calls === 0;
      calls++;
      const bar = push({ label: `GET ${url}${isEarly ? ' (sớm)' : ''}`, start: at(), tone: isEarly ? 'early' : 'api' });
      await sleep(apiMs);
      if (isEarly && failEarly) {
        finish(bar, 'err');
        throw new Error('HTTP 503');
      }
      finish(bar);
      return { views: 12, url };
    };

    // 1) <head> có script nhỏ: chạy ngay khi HTML tới
    const qf = createQuickFetch({ fetcher: fakeApi });
    if (mode === 'quick') {
      qf.makeEarlyRequest('views', `/api/views/${RECORD_ID}`);
      log.add('script đầu trang: bắn GET /api/views sớm', 'ok');
    }

    // 2) trình duyệt tải + chạy bundle
    const bundle = push({ label: 'tải + chạy main.js', start: at(), tone: 'bundle' });
    await sleep(bundleMs);
    finish(bundle);
    log.add(`bundle chạy xong ở ${at()}ms`);

    // 3) app khởi động, cần dữ liệu của record đang mở
    const id = navigated ? '0-2' : RECORD_ID;
    const fetchViews = withQuickFetch(
      'views',
      (recordId: string) => `/api/views/${recordId}`,
      (recordId: string) => fakeApi(`/api/views/${recordId}`),
      () => qf,
    );
    if (mode === 'quick') {
      const early = qf.peek()[0];
      if (navigated) log.add(`app cần /api/views/${id}, request sớm là ${early.url}: không khớp, gọi mới`, 'warn');
      else if (early.status === 'done') log.add('request sớm đã xong từ trước: dùng ngay', 'ok');
      else if (early.status === 'pending') log.add('request sớm còn đang chạy: chờ nốt', 'ok');
    }
    try {
      await fetchViews(id);
      if (mode === 'quick' && failEarly && !navigated) log.add('request sớm lỗi 503: gọi lại bằng đường thường', 'warn');
    } catch (e) {
      log.add(String(e), 'err');
    }
    const total = at();
    push({ label: 'render dữ liệu', start: total, end: total + 1, tone: 'api' });
    log.add(`có dữ liệu sau ${total}ms`, 'ok');
    setResults((r) => ({ ...r, [mode]: total }));
    setNow(total);
    setRunning(false);
  };

  const span = Math.max(bundleMs + apiMs * 2 + 100, now);

  return (
    <div className='page'>
      <h1>Quick-fetch: gọi API song song với lúc tải bundle</h1>
      <p className='hint'>
        Thường thì app phải chờ tải xong JS mới biết cần gọi API nào (thác nước). Quick-fetch đưa
        việc gọi API lên một script nhỏ ở đầu trang.
      </p>

      <div className='qf-controls'>
        <label>
          Tải bundle: <b>{bundleMs}ms</b>
          <input type='range' min={400} max={3000} step={100} value={bundleMs} onChange={(e) => setBundleMs(+e.target.value)} />
        </label>
        <label>
          API: <b>{apiMs}ms</b>
          <input type='range' min={200} max={2000} step={100} value={apiMs} onChange={(e) => setApiMs(+e.target.value)} />
        </label>
        <label>
          <input type='checkbox' checked={failEarly} onChange={(e) => setFailEarly(e.target.checked)} /> request sớm bị lỗi
        </label>
        <label>
          <input type='checkbox' checked={navigated} onChange={(e) => setNavigated(e.target.checked)} /> app cần record khác
        </label>
      </div>

      <div className='toolbar'>
        <button disabled={running} onClick={() => run('normal')}>
          Tải kiểu thường
        </button>
        <button className='primary' disabled={running} onClick={() => run('quick')}>
          Tải với quick-fetch
        </button>
      </div>

      <div className='stats'>
        <Stat label='kiểu thường: có dữ liệu sau' value={results.normal != null ? `${results.normal}ms` : '–'} />
        <Stat label='quick-fetch: có dữ liệu sau' value={results.quick != null ? `${results.quick}ms` : '–'} />
      </div>

      <div className='qf-timeline' aria-label='Dòng thời gian'>
        {bars.map((bar, i) => {
          const end = bar.end ?? now;
          return (
            <div key={i} className='qf-row'>
              <span className='qf-label'>{bar.label}</span>
              <div className='qf-track'>
                <div
                  className={`qf-bar ${bar.tone}`}
                  style={{ left: `${(bar.start / span) * 100}%`, width: `${(Math.max(end - bar.start, 2) / span) * 100}%` }}
                >
                  {bar.end != null && bar.end - bar.start > 5 ? `${bar.end - bar.start}ms` : ''}
                </div>
              </div>
            </div>
          );
        })}
        {bars.length === 0 && <p className='muted'>Bấm một nút để xem dòng thời gian.</p>}
      </div>
      <Log lines={log.lines} />
    </div>
  );
}

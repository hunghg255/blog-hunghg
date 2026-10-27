import { useEffect, useRef, useState } from 'react';
import { createTelemetry, type SpanEvent, type Telemetry } from '../lib/perfSpans';
import { busyWait, observeLongTasks, supportsLongTasks, totalBlockingTime, type TaskSegment } from '../lib/perfLongTasks';
import { createPageSwitcher } from '../lib/perfNavigation';
import { Log, Stat, sleep, useLog } from './shared';
import './PerfSpansDemo.css';

export default function PerfSpansDemo() {
  return (
    <div className='page'>
      <h1>Performance span, long task, chuyển trang không race</h1>
      <p className='hint'>
        Ba mảnh đo lường học từ Postman và Calibre. Mở DevTools → Performance → Timings để thấy các
        span ở mục 1 hiện ra như measure thật.
      </p>
      <SpansSection />
      <LongTaskSection />
      <RaceSection />
    </div>
  );
}

// ---------- 1. span + harvester ----------

function apdexTone(e: SpanEvent) {
  if (e.duration <= e.apdexMs) return 'ok' as const;
  if (e.duration <= e.apdexMs * 4) return 'warn' as const;
  return 'err' as const;
}

function SpansSection() {
  const log = useLog();
  const telemetry = useRef<Telemetry | null>(null);
  const [stats, setStats] = useState({ queued: 0, active: 0, dropped: 0 });
  const [sent, setSent] = useState(0);

  useEffect(() => {
    const t = createTelemetry({
      harvestStartMs: 2000,
      harvestIntervalMs: 3000,
      rateLimit: 3,
      maxQueue: 12,
      domains: ['workspace', 'collection', 'app'],
      report: (events) => {
        setSent((n) => n + events.length);
        log.add(`gửi lô ${events.length}: ` + events.map((e) => `${e.name} ${Math.round(e.duration)}ms`).join(', '), 'muted');
      },
      onError: (e) => log.add(`(bỏ qua lỗi đo lường) ${e.message}`, 'warn'),
    });
    telemetry.current = t;
    // marker: từ lúc bắt đầu điều hướng tới khi demo này mount
    t.marker('demo-mounted', { domain: 'app' });
    const id = setInterval(() => setStats(t.stats()), 200);
    return () => {
      clearInterval(id);
      t.destroy();
    };
  }, [log.add]);

  const openWorkspace = async () => {
    const span = telemetry.current!.startSpan('open-workspace', { domain: 'workspace', apdexMs: 500 });
    await sleep(200 + Math.random() * 1600);
    span.end();
    log.add('span open-workspace kết thúc → vào hàng đợi');
  };

  const burst = () => {
    for (let i = 0; i < 10; i++) {
      const span = telemetry.current!.startSpan('expand-collection', { domain: 'collection', uid: String(i) });
      setTimeout(() => span.end(), 50 + i * 30);
    }
    log.add('10 span chạy song song (mỗi span một uid)');
  };

  const duplicate = () => {
    const first = telemetry.current!.startSpan('import-file', { domain: 'workspace' });
    telemetry.current!.startSpan('import-file', { domain: 'workspace' }); // lỗi: span trùng
    telemetry.current!.startSpan('import-file', { domain: 'billing' }); // lỗi: domain lạ
    first.cancel(); // huỷ: không gửi số đo dở dang
  };

  return (
    <section className='card perf-section'>
      <h3>1. Span đo bằng User Timing + harvester giới hạn 3 sự kiện / 3 giây</h3>
      <div className='toolbar'>
        <button className='primary' onClick={openWorkspace}>
          Mở workspace (span)
        </button>
        <button onClick={burst}>Bắn 10 span một lúc</button>
        <button onClick={duplicate}>Gọi startSpan trùng</button>
        <button onClick={() => telemetry.current!.harvest(Infinity)}>Ẩn tab (gửi hết)</button>
      </div>
      <div className='stats'>
        <Stat label='đang đo' value={stats.active} />
        <Stat label='trong hàng đợi' value={stats.queued} />
        <Stat label='đã gửi' value={sent} />
        <Stat label='bị bỏ (hàng đợi đầy)' value={stats.dropped} />
      </div>
      <Log lines={log.lines} />
      <SpanList />
    </section>
  );
}

/** Đọc lại các sự kiện đang chờ để tô màu theo Apdex (chỉ cho demo). */
function SpanList() {
  const [events, setEvents] = useState<SpanEvent[]>([]);
  useEffect(() => {
    // nghe các measure mới để hiện danh sách; không phải một phần của thư viện
    const observer = new PerformanceObserver((list) => {
      const next = list
        .getEntries()
        .filter((e) => e.name.startsWith('telemetry:'))
        .map((e) => {
          const [, domain, name] = e.name.split(':');
          const { apdexMs } = (e as PerformanceMeasure).detail as { apdexMs: number };
          return { name, domain, startTime: e.startTime, duration: e.duration, apdexMs };
        });
      if (next.length) setEvents((prev) => [...next, ...prev].slice(0, 8));
    });
    observer.observe({ type: 'measure', buffered: true });
    return () => observer.disconnect();
  }, []);
  if (events.length === 0) return null;
  return (
    <ul className='perf-spans'>
      {events.map((e, i) => (
        <li key={i}>
          <span className={`badge ${apdexTone(e)}`}>{apdexTone(e) === 'ok' ? 'hài lòng' : apdexTone(e) === 'warn' ? 'chấp nhận' : 'bực mình'}</span>
          <code>
            {e.domain}/{e.name}
          </code>{' '}
          {Math.round(e.duration)}ms <span className='muted'>(ngưỡng {e.apdexMs}ms)</span>
        </li>
      ))}
    </ul>
  );
}

// ---------- 2. long task ----------

function LongTaskSection() {
  const [tasks, setTasks] = useState<TaskSegment[]>([]);
  const origin = useRef(performance.now());

  useEffect(() => {
    origin.current = performance.now();
    return observeLongTasks((task) => {
      // chỉ giữ task xảy ra sau khi demo mở, cho dòng thời gian dễ nhìn
      if (task.start >= origin.current) setTasks((prev) => [...prev, task].slice(-12));
    });
  }, []);

  const block = (ms: number) => {
    // để React vẽ nút "đang bấm" trước, rồi mới chặn main thread
    setTimeout(() => busyWait(ms), 0);
  };

  // trục thời gian bắt đầu ngay trước task đầu tiên, để các task không dồn về một góc
  const from = tasks.length ? tasks[0].start - 150 : 0;
  const span = Math.max(1500, ...tasks.map((t) => t.start + t.duration - from + 150));

  return (
    <section className='card perf-section'>
      <h3>2. Long task và phần chặn (kiểu biểu đồ của Calibre)</h3>
      {!supportsLongTasks() && <p className='warn'>Trình duyệt này không hỗ trợ entry type "longtask" (hiện chỉ Chromium có).</p>}
      <div className='toolbar'>
        <button onClick={() => block(30)}>Chặn 30ms</button>
        <button onClick={() => block(120)}>Chặn 120ms</button>
        <button className='primary' onClick={() => block(400)}>
          Chặn 400ms
        </button>
        <button onClick={() => setTasks([])}>Xoá</button>
      </div>
      <div className='stats'>
        <Stat label='long task' value={tasks.length} />
        <Stat label='Total Blocking Time' value={`${Math.round(totalBlockingTime(tasks))}ms`} />
      </div>
      <div className='perf-track' data-testid='longtask-track'>
        {tasks.map((t, i) => {
          const left = ((t.start - from) / span) * 100;
          return (
            <div key={i} className='perf-task' style={{ left: `${left}%`, width: `${(t.duration / span) * 100}%` }} title={`${Math.round(t.duration)}ms`}>
              <div className='perf-blocking' style={{ left: `${(50 / t.duration) * 100}%` }} />
              {t.duration / span > 0.06 && <span>{Math.round(t.duration)}ms</span>}
            </div>
          );
        })}
      </div>
      <p className='hint'>Xám: cả task. Đỏ: phần vượt 50ms, tức thời gian một cú click phải chờ thêm. Task 30ms không phải long task nên không hiện.</p>
    </section>
  );
}

// ---------- 3. race khi chuyển trang ----------

const PAGES: Record<string, number> = { 'Trang A (chậm, 1200ms)': 1200, 'Trang B (nhanh, 300ms)': 300 };

function RaceSection() {
  const [naive, setNaive] = useState('–');
  const [safe, setSafe] = useState('–');
  const log = useLog();
  const switcher = useRef(createPageSwitcher());

  const load = (name: string, signal?: AbortSignal) =>
    new Promise<string>((resolve, reject) => {
      const id = setTimeout(() => resolve(name), PAGES[name]);
      signal?.addEventListener('abort', () => {
        clearTimeout(id);
        reject(new DOMException('aborted', 'AbortError'));
      });
    });

  const open = (name: string) => {
    log.add(`bấm ${name}`);
    // Cách ngây thơ: tải xong lúc nào thì hiển thị lúc đó
    void load(name).then((page) => {
      setNaive(page);
      log.add(`ngây thơ: hiển thị ${page}`, 'warn');
    });
    // Cách an toàn: chỉ lần bấm sau cùng được hiển thị
    void switcher.current.switchPage(name, (signal) => load(name, signal), setSafe).then((shown) => {
      if (!shown) log.add(`an toàn: bỏ ${name} vì đã có lần chuyển mới hơn`, 'muted');
      else log.add(`an toàn: hiển thị ${name}`, 'ok');
    });
  };

  const quick = async () => {
    open('Trang A (chậm, 1200ms)');
    await sleep(150);
    open('Trang B (nhanh, 300ms)');
  };

  return (
    <section className='card perf-section'>
      <h3>3. Bấm A rồi B thật nhanh: trang nào được hiển thị?</h3>
      <div className='toolbar'>
        {Object.keys(PAGES).map((name) => (
          <button key={name} onClick={() => open(name)}>
            {name}
          </button>
        ))}
        <button className='primary' onClick={quick}>
          A rồi B sau 150ms
        </button>
      </div>
      <div className='stats'>
        <Stat label='ngây thơ: đang hiển thị' value={<em className='perf-val' data-testid='naive'>{naive}</em>} />
        <Stat label='an toàn: đang hiển thị' value={<em className='perf-val' data-testid='safe'>{safe}</em>} />
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

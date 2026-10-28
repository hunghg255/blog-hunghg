import { useEffect, useMemo, useState } from 'react';
import {
  backoffDelay,
  classifyStreamError,
  createManifestPoller,
  dayNumber,
  FIB_BACKOFF_SEC,
  shouldReport,
  UPLOAD_POLICY,
  type BackoffPolicy,
  type JitterMode,
  type PollEvent,
  type StreamErrorConfig,
} from '../lib/retrySchedules';
import { Stat } from './shared';
import './RetrySchedulesDemo.css';

type Tab = 'herd' | 'live' | 'cdn';

export default function RetrySchedulesDemo() {
  const [tab, setTab] = useState<Tab>('herd');
  const tabs: [Tab, string][] = [
    ['herd', '1. 1000 client cùng retry'],
    ['live', '2. Poll manifest live'],
    ['cdn', '3. Báo CDN mỗi N ngày'],
  ];
  return (
    <div className='page rs-demo'>
      <h1>Lịch retry: backoff có trần, Fibonacci, báo lỗi CDN mỗi N ngày</h1>
      <div className='rs-tabs' role='tablist'>
        {tabs.map(([k, label]) => (
          <button key={k} role='tab' aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} data-testid={`tab-${k}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'herd' && <HerdPanel />}
      {tab === 'live' && <LivePanel />}
      {tab === 'cdn' && <CdnPanel />}
    </div>
  );
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────────────────── Tab 1 ─────────────────────────

const CLIENTS = 1000;
const BUCKET = 100; // ms
const HORIZON = 16_000;

function simulateHerd(mode: JitterMode, recoverAt: number, seed: number) {
  const policy: BackoffPolicy = { ...UPLOAD_POLICY, jitterMode: mode };
  const rand = mulberry32(seed);
  const buckets = new Array(Math.ceil(HORIZON / BUCKET)).fill(0);
  let total = 0;
  let lastSuccess = 0;
  for (let c = 0; c < CLIENTS; c++) {
    // mọi client mất kết nối gần như cùng lúc (trong 50 ms đầu)
    let t = rand() * 50;
    for (let attempt = 1; ; attempt++) {
      t += backoffDelay(policy, attempt, rand);
      if (t >= HORIZON) break;
      buckets[Math.floor(t / BUCKET)]++;
      total++;
      if (t >= recoverAt) {
        lastSuccess = Math.max(lastSuccess, t);
        break;
      }
    }
  }
  // đỉnh trong 2 giây đầu sau khi server sống lại: lúc server yếu nhất
  const from = Math.floor(recoverAt / BUCKET);
  const afterPeak = Math.max(...buckets.slice(from, from + 2000 / BUCKET));
  return { buckets, total, peak: Math.max(...buckets), afterPeak, lastSuccess };
}

function HerdPanel() {
  const [recoverAt, setRecoverAt] = useState(6000);
  const [seed, setSeed] = useState(7);
  const fixed = useMemo(() => simulateHerd('fixed', recoverAt, seed), [recoverAt, seed]);
  const full = useMemo(() => simulateHerd('full', recoverAt, seed), [recoverAt, seed]);
  const equal = useMemo(() => simulateHerd('equal', recoverAt, seed), [recoverAt, seed]);
  const seq = useMemo(() => Array.from({ length: 13 }, (_, i) => backoffDelay(UPLOAD_POLICY, i + 1, () => 0.5)), []);
  const scale = Math.max(fixed.peak, full.peak, equal.peak);
  return (
    <>
      <p className='hint'>
        Server upload sập lúc 0 s, sống lại lúc {recoverAt / 1000} s. 1000 client đang upload cùng lỗi và retry theo <code>VideoUploadRetries</code>: delay{' '}
        <code>min(400 + 100·1,5^(n−1), 8000)</code>. Biểu đồ đếm request mỗi {BUCKET} ms. Jitter ±50 ms giữ các client gần như cùng nhịp, nên lúc server vừa sống lại cả nghìn request ập tới trong vài trăm mili giây. Full jitter rải đều nhưng tốn nhiều lần thử hơn; equal jitter ở giữa.
      </p>
      <p className='rs-seq'>
        Dãy delay (chưa jitter): {seq.map((d, i) => (
          <span key={i}>{d}</span>
        ))}
      </p>
      <div className='toolbar'>
        <label>
          server sống lại lúc <b>{recoverAt / 1000} s</b>{' '}
          <input type='range' min={1000} max={12000} step={500} value={recoverAt} onChange={(e) => setRecoverAt(Number(e.target.value))} data-testid='recover' />
        </label>
        <button onClick={() => setSeed((s) => s + 1)}>Chạy lại</button>
      </div>
      <Histogram title='Jitter cố định ±50 ms (bản gốc)' data={fixed} scale={scale} recoverAt={recoverAt} tone='err' testid='fixed' />
      <Histogram title='Full jitter: ngẫu nhiên trong [0, delay]' data={full} scale={scale} recoverAt={recoverAt} tone='ok' testid='full' />
      <Histogram title='Equal jitter: ngẫu nhiên trong [delay/2, delay]' data={equal} scale={scale} recoverAt={recoverAt} tone='ok' testid='equal' />
    </>
  );
}

function Histogram({ title, data, scale, recoverAt, tone, testid }: { title: string; data: ReturnType<typeof simulateHerd>; scale: number; recoverAt: number; tone: string; testid: string }) {
  const w = data.buckets.length;
  return (
    <div className='card rs-hist'>
      <div className='rs-hist-head'>
        <b>{title}</b>
        <span>
          lúc server vừa sống lại: <output data-testid={`${testid}-peak`}>{data.afterPeak}</output> req/{BUCKET} ms · tổng {data.total} request · client cuối xong lúc {(data.lastSuccess / 1000).toFixed(1)} s
        </span>
      </div>
      <svg viewBox={`0 0 ${w} 100`} preserveAspectRatio='none' role='img' aria-label={title}>
        <line x1={recoverAt / BUCKET} x2={recoverAt / BUCKET} y1={0} y2={100} className='rs-recover' />
        {data.buckets.map((v, i) => (v ? <rect key={i} x={i + 0.1} width={0.8} y={100 - (v / scale) * 100} height={(v / scale) * 100} className={`rs-bar ${tone}`} /> : null))}
      </svg>
      <div className='rs-axis'>
        <span>0 s</span>
        <span>{HORIZON / 2000} s</span>
        <span>{HORIZON / 1000} s</span>
      </div>
    </div>
  );
}

// ───────────────────────── Tab 2 ─────────────────────────

const PERIOD = 2000;
const LIVE_HORIZON = 60_000;

interface Segment {
  until: number;
  code: string; // 'ok' | mã lỗi | 'stale' (ok nhưng endTime đứng yên)
}
const PRESETS: Record<string, { label: string; segs: Segment[] }> = {
  blip: { label: '503 trong 10 giây', segs: [{ until: 8000, code: 'ok' }, { until: 18000, code: '503' }, { until: Infinity, code: 'ok' }] },
  gateway: { label: '504 kéo dài 40 giây', segs: [{ until: 6000, code: 'ok' }, { until: 46000, code: '504' }, { until: Infinity, code: 'ok' }] },
  gone: { label: 'Live kết thúc (410)', segs: [{ until: 10000, code: 'ok' }, { until: Infinity, code: '410' }] },
  stale: { label: 'Manifest đứng yên', segs: [{ until: 8000, code: 'ok' }, { until: 20000, code: 'stale' }, { until: Infinity, code: 'ok' }] },
};
const codeAt = (segs: Segment[], t: number) => segs.find((s) => t < s.until)!.code;

/** cấu hình mặc định của bản gốc: không có mã kết thúc, không có mã Fibonacci */
const FB_DEFAULT: StreamErrorConfig = { endCodes: [], skipCodes: [], fibCodes: [], retryIntervals: { '0': 1000, '404': 2000, '502': 1000, '503': 1000, '504': 1000 } };

interface Dot {
  at: number;
  ok: boolean;
  label: string;
}
interface Run {
  dots: Dot[];
  outcome: string;
  notes: string[];
}

/** bản gốc: handler trả delay nhưng retry() của MpdUpdater bỏ qua nó, poll lại theo minimumUpdatePeriod */
function runOriginal(segs: Segment[]): Run {
  const dots: Dot[] = [];
  let t = 0;
  let attempt = 0;
  let lastEnd = -1;
  let same = 0;
  const notes: string[] = [];
  while (t < LIVE_HORIZON) {
    const code = codeAt(segs, t);
    if (code === 'ok' || code === 'stale') {
      const end = code === 'stale' ? lastEnd : Math.floor(t / 1000);
      same = end === lastEnd ? same + 1 : 0;
      if (same === 3) notes.push(`${(t / 1000).toFixed(0)} s: streamInterruptAt`);
      lastEnd = end;
      attempt = 0;
      dots.push({ at: t, ok: true, label: '' });
      t += PERIOD;
      continue;
    }
    const next = classifyStreamError(code, attempt++, FB_DEFAULT);
    if (next.action !== 'retry') {
      dots.push({ at: t, ok: false, label: code });
      const exhausted = attempt > FIB_BACKOFF_SEC.length;
      return { dots, outcome: `player báo lỗi lúc ${(t / 1000).toFixed(0)} s (${exhausted ? 'hết 10 lần thử' : 'không có luật cho mã ' + code})`, notes };
    }
    dots.push({ at: t, ok: false, label: `xin ${next.delayMs / 1000}s` });
    t += PERIOD; // delay bị bỏ qua
  }
  return { dots, outcome: 'vẫn đang chạy', notes };
}

/** bản viết lại: createManifestPoller với đồng hồ giả */
async function runFixed(segs: Segment[]): Promise<Run> {
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const dots: Dot[] = [];
  const notes: string[] = [];
  let outcome = 'vẫn đang chạy';
  let lastEnd = 0;
  const poller = createManifestPoller({
    periodMs: PERIOD,
    staleThreshold: 3,
    now: () => now,
    setTimer: (fn, ms) => timers.push({ at: now + ms, fn }),
    clearTimer: () => {},
    fetch: async () => {
      const code = codeAt(segs, now);
      if (code === 'ok') lastEnd = Math.floor(now / 1000);
      else if (code !== 'stale') throw { code };
      return lastEnd;
    },
    onEvent: (e: PollEvent) => {
      if (e.type === 'ok') dots.push({ at: e.at, ok: true, label: '' });
      else if (e.type === 'error') dots.push({ at: e.at, ok: false, label: e.next.action === 'retry' ? `chờ ${e.next.delayMs / 1000}s` : e.code });
      else if (e.type === 'interrupted' || e.type === 'resumed') notes.push(`${(e.at / 1000).toFixed(0)} s: ${e.type === 'interrupted' ? 'stream đứng' : 'stream chạy lại'}`);
      else if (e.type === 'ended') outcome = `kết thúc êm lúc ${(e.at / 1000).toFixed(0)} s (410: buổi live đã hết)`;
      else outcome = `báo lỗi lúc ${(e.at / 1000).toFixed(0)} s`;
    },
  });
  poller.start();
  while (timers.length) {
    timers.sort((a, b) => a.at - b.at);
    const next = timers.shift()!;
    if (next.at >= LIVE_HORIZON) break;
    now = next.at;
    next.fn();
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }
  poller.stop();
  return { dots, outcome, notes };
}

function LivePanel() {
  const [preset, setPreset] = useState('gateway');
  const segs = PRESETS[preset].segs;
  const orig = useMemo(() => runOriginal(segs), [segs]);
  const [fixed, setFixed] = useState<Run | null>(null);
  useEffect(() => {
    let alive = true;
    runFixed(segs).then((r) => alive && setFixed(r));
    return () => {
      alive = false;
    };
  }, [segs]);
  return (
    <>
      <p className='hint'>
        Player live tải lại manifest mỗi <code>minimumUpdatePeriod</code> ({PERIOD / 1000} s). Khi lỗi, <code>handleOzStreamErrorEvent</code> tính delay (bảng theo mã, hoặc Fibonacci{' '}
        <code>0,1,1,2,3,5,8,13,21,34</code> giây) rồi gọi <code>retry(delay)</code>. Nhưng <code>retry</code> mà <code>OzMpdUpdater</code> truyền vào bỏ qua tham số, nên delay không bao giờ được dùng.
      </p>
      <div className='toolbar'>
        {Object.entries(PRESETS).map(([k, p]) => (
          <button key={k} className={k === preset ? 'primary' : ''} onClick={() => setPreset(k)} data-testid={`preset-${k}`}>
            {p.label}
          </button>
        ))}
      </div>
      <ServerStrip segs={segs} />
      <Timeline title='Bản gốc (cấu hình mặc định)' run={orig} testid='orig' />
      {fixed && <Timeline title='Bản viết lại (dùng delay, 410 = kết thúc, 504 theo Fibonacci)' run={fixed} testid='fixed' />}
    </>
  );
}

function ServerStrip({ segs }: { segs: Segment[] }) {
  let from = 0;
  return (
    <div className='rs-strip'>
      <span className='rs-strip-label'>server</span>
      <div className='rs-track'>
        {segs.map((s, i) => {
          const to = Math.min(s.until, LIVE_HORIZON);
          const el = <i key={i} className={`rs-seg ${s.code === 'ok' ? 'ok' : s.code === 'stale' ? 'stale' : 'err'}`} style={{ left: `${(from / LIVE_HORIZON) * 100}%`, width: `${((to - from) / LIVE_HORIZON) * 100}%` }} title={s.code} />;
          from = to;
          return el;
        })}
      </div>
    </div>
  );
}

function Timeline({ title, run, testid }: { title: string; run: Run; testid: string }) {
  const errs = run.dots.filter((d) => !d.ok);
  return (
    <div className='card rs-live'>
      <b>{title}</b>
      <div className='rs-strip'>
        <span className='rs-strip-label'>request</span>
        <div className='rs-track'>
          {run.dots.map((d, i) => (
            <i key={i} className={`rs-dot ${d.ok ? 'ok' : 'err'}`} style={{ left: `${(d.at / LIVE_HORIZON) * 100}%` }} title={`${(d.at / 1000).toFixed(1)} s ${d.label}`} />
          ))}
        </div>
      </div>
      <div className='stats'>
        <Stat label='request manifest' value={<output data-testid={`${testid}-count`}>{run.dots.length}</output>} />
        <Stat label='request lỗi' value={errs.length} />
        <Stat label='kết cục' value={<output data-testid={`${testid}-outcome`} className='rs-outcome'>{run.outcome}</output>} />
      </div>
      <p className='rs-errs'>
        {errs.slice(0, 12).map((d, i) => (
          <span key={i}>
            {(d.at / 1000).toFixed(0)}s {d.label}
          </span>
        ))}
        {errs.length > 12 && <span>…</span>}
        {run.notes.map((n) => (
          <span key={n} className='rs-note'>
            {n}
          </span>
        ))}
      </p>
    </div>
  );
}

// ───────────────────────── Tab 3 ─────────────────────────

const START = Date.UTC(2026, 9, 28, 9);

function originalShould(stored: string | null, nowMs: number, freq: number) {
  // nguyên văn logic SyntaxErrorMonitor: !a || c - a >= bump_freq_day
  const c = dayNumber(nowMs);
  const a = stored == null ? null : Number(stored);
  return !a || c - a >= freq ? { report: true, store: c } : { report: false, store: a };
}

function CdnPanel() {
  const [freq, setFreq] = useState(3);
  const [day, setDay] = useState(0);
  const [skew, setSkew] = useState(0);
  const [state, setState] = useState({ orig: null as string | null, fixed: null as string | null, origBeacons: [] as string[], fixedBeacons: [] as string[], errors: 0 });
  const clock = START + (day + skew) * 86_400_000;

  const hit = () => {
    setState((s) => {
      const o = originalShould(s.orig, clock, freq);
      const f = shouldReport(s.fixed, clock, freq);
      const label = `ngày ${day + 1}${skew ? ` (máy lệch ${skew > 0 ? '+' : ''}${skew})` : ''}`;
      return {
        orig: String(o.store),
        fixed: String(f.store),
        origBeacons: o.report ? [...s.origBeacons, label] : s.origBeacons,
        fixedBeacons: f.report ? [...s.fixedBeacons, label] : s.fixedBeacons,
        errors: s.errors + 1,
      };
    });
  };

  return (
    <>
      <p className='hint'>
        Một <code>SyntaxError</code> trong JavaScript thường nghĩa là file trên CDN bị cắt cụt hoặc lệch phiên bản. Mỗi trình duyệt chỉ báo về server tối đa một lần mỗi {freq} ngày: cookie{' '}
        <code>js_ver</code> giữ <i>số ngày</i> kể từ 2010-01-01 của lần báo trước.
      </p>
      <div className='toolbar'>
        <label>
          tối đa 1 lần / <b>{freq} ngày</b> <input type='range' min={1} max={7} value={freq} onChange={(e) => setFreq(Number(e.target.value))} />
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={hit} data-testid='hit'>
          Gặp SyntaxError
        </button>
        <button onClick={() => setDay((d) => d + 1)} data-testid='day'>
          +1 ngày
        </button>
        <button onClick={() => setSkew((s) => (s ? 0 : 30))} data-testid='skew'>
          {skew ? 'Chỉnh lại đồng hồ máy' : 'Đồng hồ máy chạy nhanh 30 ngày'}
        </button>
      </div>
      <div className='stats'>
        <Stat label='hôm nay (số ngày từ 2010)' value={<output data-testid='today'>{dayNumber(clock)}</output>} />
        <Stat label='lỗi đã gặp' value={state.errors} />
      </div>
      <div className='split'>
        <div className='card'>
          <b>Bản gốc</b>
          <p className='hint'>
            cookie js_ver = <code data-testid='orig-cookie'>{state.orig ?? '(chưa có)'}</code>
          </p>
          <p>
            beacon: <output data-testid='orig-beacons'>{state.origBeacons.length}</output>
          </p>
          <ul className='rs-beacons'>{state.origBeacons.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
        <div className='card'>
          <b>Bản viết lại</b>
          <p className='hint'>
            cookie js_ver = <code data-testid='fixed-cookie'>{state.fixed ?? '(chưa có)'}</code>
          </p>
          <p>
            beacon: <output data-testid='fixed-beacons'>{state.fixedBeacons.length}</output>
          </p>
          <ul className='rs-beacons'>{state.fixedBeacons.map((b, i) => <li key={i}>{b}</li>)}</ul>
        </div>
      </div>
      <p className='hint'>Thử: bật "đồng hồ chạy nhanh", gặp lỗi, chỉnh lại đồng hồ, rồi gặp lỗi mỗi ngày. Bản gốc im lặng gần 30 ngày vì cookie nằm ở tương lai.</p>
    </>
  );
}

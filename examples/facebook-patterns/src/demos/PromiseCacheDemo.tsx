import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createLazyLoader,
  createPreloadSlot,
  createPromiseCache,
  preloadOrFetch,
  requestDeltas,
  type PreloadResult,
} from '../lib/promiseCache';
import { Log, Stat, useLog } from './shared';
import './PromiseCacheDemo.css';

type Tab = 'cache' | 'flight' | 'preload';

export default function PromiseCacheDemo() {
  const [tab, setTab] = useState<Tab>('cache');
  const tabs: [Tab, string][] = [
    ['cache', '1. Cache Promise'],
    ['flight', '2. Lỗi bị nhớ mãi'],
    ['preload', '3. Dữ liệu nhúng đua request'],
  ];
  return (
    <div className='page pc-demo'>
      <h1>Cache Promise gộp request, cache lỗi ngắn, đua dữ liệu nhúng sẵn</h1>
      <div className='pc-tabs' role='tablist'>
        {tabs.map(([k, label]) => (
          <button key={k} role='tab' aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} data-testid={`tab-${k}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'cache' && <CachePanel />}
      {tab === 'flight' && <FlightPanel />}
      {tab === 'preload' && <PreloadPanel />}
    </div>
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ───────────────────────── Tab 1 ─────────────────────────

const COMPONENTS = ['Header', 'Sidebar', 'Composer', 'Feed'];
const ERROR_TTL = 9_000;

function CachePanel() {
  const { lines, add } = useLog(60);
  const [mode, setMode] = useState<'none' | 'cache'>('cache');
  const [failing, setFailing] = useState(true);
  const [sticky, setSticky] = useState(false);
  const [calls, setCalls] = useState(0);
  const [status, setStatus] = useState<Record<string, string>>({});
  const [, setTick] = useState(0);
  const failingRef = useRef(failing);
  failingRef.current = failing;
  const stickyBypass = useRef(false);
  const cache = useMemo(() => createPromiseCache<{ name: string }>({ errorTtlMs: ERROR_TTL, ttlMs: 30_000 }), []);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const api = async () => {
    setCalls((c) => c + 1);
    add('→ gọi mạng GET /me', 'muted');
    await sleep(500);
    if (failingRef.current) throw new Error('503');
    return { name: 'Hùng' };
  };

  const loadAll = () => {
    for (const c of COMPONENTS) {
      setStatus((s) => ({ ...s, [c]: 'đang tải…' }));
      const p = mode === 'none' ? api() : cache.get('me', api, { bypass: stickyBypass.current });
      p.then(
        (v) => setStatus((s) => ({ ...s, [c]: `xin chào ${v.name}` })),
        (e: Error) => setStatus((s) => ({ ...s, [c]: `lỗi ${e.message}` })),
      );
    }
  };

  const clear = () => {
    cache.invalidate('me');
    if (sticky) stickyBypass.current = true;
    add(sticky ? 'clearCache() kiểu bản gốc: cờ bỏ qua cache dính vĩnh viễn' : 'invalidate("me"): chỉ lần gọi sau đi mạng', sticky ? 'err' : 'ok');
  };

  const entry = cache.entries().find((e) => e.key === 'me');
  return (
    <>
      <p className='hint'>
        Bốn component cùng cần <code>/me</code> lúc trang mở. Cache chính Promise thì bốn component chờ chung một request. Request lỗi thì Promise lỗi cũng được cache {ERROR_TTL / 1000} giây: bấm tải lại liên tục
        trong lúc API sập không tạo thêm request nào.
      </p>
      <div className='toolbar'>
        <label>
          <input type='radio' checked={mode === 'none'} onChange={() => setMode('none')} data-testid='mode-none' /> không cache
        </label>
        <label>
          <input type='radio' checked={mode === 'cache'} onChange={() => setMode('cache')} data-testid='mode-cache' /> cache Promise
        </label>
        <label className='switch'>
          <input type='checkbox' checked={failing} onChange={(e) => setFailing(e.target.checked)} data-testid='failing' /> API đang lỗi
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={loadAll} data-testid='load'>
          Tải lại cả 4 component
        </button>
        <button onClick={clear} data-testid='clear'>
          Xoá cache
        </button>
        <label className='switch'>
          <input type='checkbox' checked={sticky} onChange={(e) => setSticky(e.target.checked)} data-testid='sticky' /> mô phỏng bug clearCache
        </label>
      </div>
      <div className='stats'>
        <Stat label='request mạng' value={<output data-testid='calls'>{calls}</output>} />
        <Stat
          label='entry "me" trong cache'
          value={
            <output data-testid='entry'>
              {mode === 'none' || !entry ? '—' : `${entry.status}${Number.isFinite(entry.expiresInMs) ? ` · còn ${Math.max(0, Math.ceil(entry.expiresInMs / 1000))}s` : ''}`}
            </output>
          }
        />
      </div>
      <div className='pc-grid'>
        {COMPONENTS.map((c) => (
          <div key={c} className='card'>
            <b>{c}</b>
            <div className={status[c]?.startsWith('lỗi') ? 'err' : status[c]?.startsWith('xin') ? 'ok' : 'muted'}>{status[c] ?? 'chưa tải'}</div>
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </>
  );
}

// ───────────────────────── Tab 2 ─────────────────────────

const FRIENDS = ['An', 'Anh Thư', 'Bảo', 'Bình', 'Châu', 'Chi', 'Dũng', 'Hà', 'Hải', 'Hùng', 'Lan', 'Linh', 'Minh', 'Nam', 'Ngọc', 'Phương', 'Quân', 'Tâm', 'Thảo', 'Trang'];

function FlightPanel() {
  const [failFirst, setFailFirst] = useState(true);
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ orig: string[]; fixed: string[] }>({ orig: [], fixed: [] });
  const [reqs, setReqs] = useState({ orig: 0, fixed: 0 });
  const [version, setVersion] = useState(0);

  const loaders = useMemo(() => {
    const make = (which: 'orig' | 'fixed') => {
      let n = 0;
      return async () => {
        n++;
        setReqs((r) => ({ ...r, [which]: r[which] + 1 }));
        await sleep(300);
        if (failFirst && n === 1) throw new Error('mạng chập chờn');
        return FRIENDS;
      };
    };
    // bản gốc: giữ Promise kể cả khi lỗi, lỗi bị nuốt (promiseDone(…, emptyFunction))
    let origPromise: Promise<string[]> | null = null;
    let origEntries: string[] | null = null;
    const origLoad = make('orig');
    const original = (cb: (list: string[]) => void) => {
      if (origEntries) return cb(origEntries);
      if (!origPromise) origPromise = origLoad().then((l) => (origEntries = l));
      origPromise.then(() => cb(origEntries!), () => {});
    };
    const fixed = createLazyLoader(make('fixed'));
    return { original, fixed };
    // version: bấm "tải lại trang" thì tạo loader mới
  }, [failFirst, version]);

  const search = (text: string) => {
    setQ(text);
    const fold = (x: string) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').toLowerCase();
    const match = (list: string[]) => list.filter((n) => text && fold(n).startsWith(fold(text)));
    loaders.original((list) => setRes((r) => ({ ...r, orig: match(list) })));
    loaders.fixed.get().then(
      (list) => setRes((r) => ({ ...r, fixed: match(list) })),
      () => setRes((r) => ({ ...r, fixed: [] })),
    );
  };

  const reload = () => {
    setVersion((v) => v + 1);
    setReqs({ orig: 0, fixed: 0 });
    setRes({ orig: [], fixed: [] });
    setQ('');
  };

  return (
    <>
      <p className='hint'>
        Typeahead chọn bạn bè tải danh sách 50 người <i>một lần</i> rồi lọc tại chỗ. Lần tải đầu lỗi: bản gốc giữ Promise lỗi trong biến module và nuốt lỗi, nên mọi lần gõ sau im lặng không ra gì
        tới khi tải lại trang. Bản sửa bỏ Promise khi lỗi, lần gõ sau tải lại.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={failFirst} onChange={(e) => setFailFirst(e.target.checked)} /> request đầu tiên lỗi
        </label>
        <button onClick={reload} data-testid='reload'>
          Tải lại trang
        </button>
      </div>
      <input className='pc-input' placeholder='Gõ tên, vd "h"' value={q} onChange={(e) => search(e.target.value)} data-testid='q' />
      <div className='split'>
        <div className='card'>
          <b>Bản gốc</b> <span className='badge'>{reqs.orig} request</span>
          <ul className='pc-results' data-testid='orig'>
            {res.orig.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {q && !res.orig.length && <li className='muted'>(không có kết quả)</li>}
          </ul>
        </div>
        <div className='card'>
          <b>Bản sửa</b> <span className='badge'>{reqs.fixed} request</span>
          <ul className='pc-results' data-testid='fixed'>
            {res.fixed.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {q && !res.fixed.length && <li className='muted'>(không có kết quả)</li>}
          </ul>
        </div>
      </div>
    </>
  );
}

// ───────────────────────── Tab 3 ─────────────────────────

const SERVER_FIELDS = ['id', 'name', 'budget', 'status'];

function PreloadPanel() {
  const { lines, add } = useLog(40);
  const [serverMs, setServerMs] = useState(1200);
  const [apiMs, setApiMs] = useState(900);
  const [waitMs, setWaitMs] = useState(2000);
  const [extraField, setExtraField] = useState(false);
  const [result, setResult] = useState<(PreloadResult<unknown> & { ms: number }) | null>(null);
  const [running, setRunning] = useState(false);

  const client = { path: '/act_1/campaigns', params: { limit: 25 }, fields: extraField ? ['id', 'name', 'spend'] : ['id', 'name'] };
  const server = { path: '/act_1/campaigns', params: { limit: 25 }, fields: SERVER_FIELDS };
  const deltas = requestDeltas(client, server);

  const run = async () => {
    setRunning(true);
    setResult(null);
    const t0 = performance.now();
    const slot = createPreloadSlot<{ from: string }>();
    // server đẩy JSON nhúng sẵn vào trang sau serverMs
    setTimeout(() => {
      slot.resolve({ from: 'server' });
      add(`+${serverMs} ms: dữ liệu nhúng tới`);
    }, serverMs);
    const r = await preloadOrFetch({
      slot,
      waitMs,
      matches: () => deltas.length === 0,
      fetch: async () => {
        const at = Math.round(performance.now() - t0);
        add(`+${at} ms: gọi API`, 'muted');
        await sleep(apiMs);
        add(`+${Math.round(performance.now() - t0)} ms: API trả về`);
        return { from: 'client' };
      },
    });
    const ms = Math.round(performance.now() - t0);
    add(`${r.outcome} sau ${ms} ms${r.fetched ? ' (có gọi API)' : ''}`, r.outcome.startsWith('PRELOAD') ? 'ok' : 'warn');
    setResult({ ...r, ms });
    setRunning(false);
  };

  const max = Math.max(serverMs, waitMs + apiMs, 1) * 1.1;
  const pct = (x: number) => `${(x / max) * 100}%`;
  return (
    <>
      <p className='hint'>
        Server bắt đầu truy vấn dữ liệu ngay khi nhận request trang, rồi nhúng JSON vào cuối HTML. JavaScript chạy tới chỗ cần dữ liệu thì chờ tối đa <code>waitMs</code>. Tới kịp và đủ trường thì dùng luôn,
        không thì gọi API và đua: ai về trước thắng.
      </p>
      <div className='pc-sliders'>
        <label>
          dữ liệu nhúng tới sau <b>{serverMs} ms</b>
          <input type='range' min={0} max={4000} step={100} value={serverMs} onChange={(e) => setServerMs(Number(e.target.value))} data-testid='server-ms' />
        </label>
        <label>
          API mất <b>{apiMs} ms</b>
          <input type='range' min={100} max={3000} step={100} value={apiMs} onChange={(e) => setApiMs(Number(e.target.value))} data-testid='api-ms' />
        </label>
        <label>
          chờ tối đa <b>{waitMs} ms</b>
          <input type='range' min={0} max={3000} step={100} value={waitMs} onChange={(e) => setWaitMs(Number(e.target.value))} data-testid='wait-ms' />
        </label>
        <label className='switch'>
          <input type='checkbox' checked={extraField} onChange={(e) => setExtraField(e.target.checked)} data-testid='extra' /> client cần thêm field <code>spend</code>
        </label>
      </div>
      <div className='pc-timeline'>
        <div className='pc-row'>
          <span>dữ liệu nhúng</span>
          <span className='pc-track'>
            <i className='pc-mark server' style={{ left: pct(serverMs) }} />
          </span>
        </div>
        <div className='pc-row'>
          <span>chờ rồi gọi API</span>
          <span className='pc-track'>
            <i className='pc-span wait' style={{ left: 0, width: pct(waitMs) }} />
            <i className='pc-span api' style={{ left: pct(waitMs), width: pct(apiMs) }} />
          </span>
        </div>
      </div>
      <p className='hint'>
        Khớp request: <b className={deltas.length ? 'warn' : 'ok'}>{deltas.length ? `lệch ${deltas.join(', ')}` : 'client là tập con của server'}</b>
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={run} disabled={running} data-testid='run'>
          Chạy
        </button>
      </div>
      <div className='stats'>
        <Stat label='kết quả' value={<output data-testid='outcome'>{result?.outcome ?? '—'}</output>} />
        <Stat label='thời gian có dữ liệu' value={<output data-testid='ms'>{result ? `${result.ms} ms` : '—'}</output>} />
        <Stat label='request API' value={<output data-testid='fetched'>{result ? (result.fetched ? 'có' : 'không') : '—'}</output>} />
      </div>
      <Log lines={lines} />
    </>
  );
}

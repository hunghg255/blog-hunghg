import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Log, Stat, sleep, useLog } from './shared';
import { createLateContext, createRegistry, loadApps, type AppModule } from '../lib/udAppLoader';
import { createUdemyStyleRegistry, loadAppsUdemyStyle } from './UdAppLoaderUdemyStyle';
import './UdAppLoaderDemo.css';

// ---------------------------------------------------------------- 1. nạp các "đảo" app

const APPS = [
  { id: 'header', priority: -10, ms: 300 },
  { id: 'browse', priority: 10, ms: 600 },
  { id: 'sidebar', priority: 0, ms: 400 },
  { id: 'footer', priority: -10, ms: 300 },
];

type Bar = { id: string; start: number; end?: number; boot?: number; error?: boolean };

function LoaderSection() {
  const [mode, setMode] = useState<'udemy' | 'rewrite'>('rewrite');
  const [failSidebar, setFailSidebar] = useState(true);
  const [bars, setBars] = useState<Record<string, Bar>>({});
  const [total, setTotal] = useState<number | null>(null);
  const [classes, setClasses] = useState<Record<string, string>>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const attempts = useRef(0);
  const log = useLog(6);

  const readClasses = () => {
    const out: Record<string, string> = {};
    rootRef.current?.querySelectorAll<HTMLElement>('.ud-app-loader').forEach((el) => {
      out[el.dataset.moduleId!] = [...el.classList].filter((c) => c !== 'ud-app-loader').join(' ') || 'chưa chạy';
    });
    setClasses(out);
  };

  const run = async (fresh: boolean) => {
    const root = rootRef.current!;
    if (fresh) {
      attempts.current = 0;
      root.querySelectorAll<HTMLElement>('.ud-app-loader').forEach((el) => {
        el.className = 'ud-app-loader';
        el.textContent = el.dataset.moduleId!;
      });
    }
    setBars({});
    setTotal(null);
    const t0 = performance.now();
    const importApp = async (id: string): Promise<AppModule> => {
      const app = APPS.find((a) => a.id === id)!;
      await sleep(app.ms);
      if (id === 'sidebar' && failSidebar && attempts.current++ === 0) throw new Error('ChunkLoadError');
      return { bootstrap: (el) => (el.textContent = `${id} ✓`) };
    };
    const onEvent = ({ moduleId, type, at }: { moduleId: string; type: string; at: number }) => {
      setBars((b) => {
        const bar = b[moduleId] ?? { id: moduleId, start: at };
        if (type === 'import-start') bar.start = at;
        if (type === 'import-end') bar.end = at;
        if (type === 'bootstrap') bar.boot = at;
        if (type === 'error') bar.error = true;
        return { ...b, [moduleId]: { ...bar } };
      });
      readClasses();
    };
    const { done } =
      mode === 'udemy' ? loadAppsUdemyStyle(root, { importApp, onEvent }) : loadApps(root, { importApp, onEvent });
    await done;
    const ms = Math.round(performance.now() - t0);
    setTotal(ms);
    readClasses();
    log.add(`${mode === 'udemy' ? 'Kiểu Udemy' : 'Viết lại'}: xong sau ${ms}ms`);
  };

  const scale = 1400;
  return (
    <section className='card ud-al'>
      <h2>1. Bốn app trên một trang, có độ ưu tiên</h2>
      <p className='hint'>
        browse (ưu tiên 10, chunk 600ms), sidebar (0, 400ms), header và footer (−10, 300ms). Kiểu Udemy chỉ bắt đầu
        tải chunk của nhóm sau khi nhóm trước khởi động xong. Bật "sidebar lỗi lần đầu", bấm Nạp, rồi bấm "Nạp lại phần
        còn thiếu".
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        <button className={mode === 'udemy' ? 'primary' : ''} aria-pressed={mode === 'udemy'} onClick={() => setMode('udemy')}>
          Kiểu Udemy
        </button>
        <button className={mode === 'rewrite' ? 'primary' : ''} aria-pressed={mode === 'rewrite'} onClick={() => setMode('rewrite')}>
          Viết lại
        </button>
        <label className='switch'>
          <input type='checkbox' checked={failSidebar} onChange={(e) => setFailSidebar(e.target.checked)} /> sidebar lỗi lần đầu
        </label>
        <button className='primary' onClick={() => run(true)} data-testid='al-run'>
          Nạp
        </button>
        <button onClick={() => run(false)} data-testid='al-rerun'>
          Nạp lại phần còn thiếu
        </button>
      </div>
      <div className='stats'>
        <Stat label='Tổng thời gian (ms)' value={<bdi data-testid='al-total'>{total ?? '—'}</bdi>} />
        <Stat label='Class của sidebar' value={<bdi data-testid='al-sidebar-class'>{classes.sidebar ?? '—'}</bdi>} />
      </div>
      <div className='ud-al-page' ref={rootRef}>
        {APPS.map((a) => (
          <div
            key={a.id}
            className='ud-app-loader'
            data-module-id={a.id}
            data-module-priority={a.priority}
            data-testid={`al-${a.id}`}
          >
            {a.id}
          </div>
        ))}
      </div>
      <div className='ud-al-timeline' aria-label='Dòng thời gian'>
        {APPS.map((a) => {
          const b = bars[a.id];
          return (
            <div key={a.id} className='ud-al-row'>
              <span className='ud-al-name'>{a.id}</span>
              <div className='ud-al-track'>
                {b && (
                  <div
                    className={`ud-al-import ${b.error ? 'ud-al-error' : ''}`}
                    style={{ left: `${(b.start / scale) * 100}%`, width: `${(((b.end ?? b.start + 4) - b.start) / scale) * 100}%` }}
                  />
                )}
                {b?.boot !== undefined && <div className='ud-al-boot' style={{ left: `${(b.boot / scale) * 100}%` }} />}
              </div>
            </div>
          );
        })}
      </div>
      <p className='muted ud-al-legend'>Thanh tím: tải chunk · vạch xanh: khởi động · đỏ: lỗi</p>
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 2. registry

interface PlayerStore {
  name: string;
  time: string;
}

function RegistrySection() {
  const [mode, setMode] = useState<'udemy' | 'rewrite'>('rewrite');
  const registry = useMemo(
    () => (mode === 'udemy' ? createUdemyStyleRegistry() : createRegistry<{ player: PlayerStore }>()),
    [mode],
  );
  const [openA, setOpenA] = useState(true);
  const [openB, setOpenB] = useState(false);

  return (
    <section className='card ud-al'>
      <h2>2. Store dùng chung giữa hai nhánh cây component</h2>
      <p className='hint'>
        Player A đăng ký store <code>player</code>; khung ghi chú ở nhánh khác đọc nó. Mở player B (ví dụ chế độ
        rạp chiếu), rồi đóng A: kiểu Udemy gỡ luôn store của B.
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ registry'>
        <button className={mode === 'udemy' ? 'primary' : ''} aria-pressed={mode === 'udemy'} onClick={() => setMode('udemy')}>
          Kiểu Udemy
        </button>
        <button className={mode === 'rewrite' ? 'primary' : ''} aria-pressed={mode === 'rewrite'} onClick={() => setMode('rewrite')}>
          Viết lại
        </button>
        <button onClick={() => setOpenB(true)} disabled={openB} data-testid='rg-open-b'>
          Mở player B
        </button>
        <button onClick={() => setOpenA(false)} disabled={!openA} data-testid='rg-close-a'>
          Đóng player A
        </button>
        <button onClick={() => (setOpenA(true), setOpenB(false))}>Đặt lại</button>
      </div>
      <div className='split' key={mode}>
        <div>
          {openA && <Player registry={registry} name='A' time='01:23' />}
          {openB && <Player registry={registry} name='B' time='01:23' />}
        </div>
        <Notes registry={registry} />
      </div>
    </section>
  );
}

type AnyRegistry = {
  register: (name: 'player', store: PlayerStore) => () => void;
  get: (name: 'player') => unknown;
  subscribe: (l: () => void) => () => unknown;
};

function Player({ registry, name, time }: { registry: AnyRegistry; name: string; time: string }) {
  useEffect(() => registry.register('player', { name, time }), [registry, name, time]);
  return <div className='ud-al-player'>▶ Player {name}</div>;
}

function Notes({ registry }: { registry: AnyRegistry }) {
  const store = useSyncExternalStore(
    (cb) => {
      const off = registry.subscribe(cb);
      return () => void off();
    },
    () => registry.get('player') as PlayerStore | undefined,
  );
  return (
    <div className='ud-al-notes' data-testid='rg-notes'>
      {store ? `Ghi chú tại ${store.time} (player ${store.name})` : 'Chưa có player: khung ghi chú ẩn'}
    </div>
  );
}

// ---------------------------------------------------------------- 3. context tới muộn

function LateSection() {
  const [fail, setFail] = useState(true);
  const [run, setRun] = useState(0);
  const [early, setEarly] = useState('');
  const [udemyLoading, setUdemyLoading] = useState(true);
  const ctx = useMemo(() => {
    let tries = 0;
    return createLateContext<{ name: string }>('me', async () => {
      await sleep(400);
      if (fail && tries++ === 0) throw new Error('503 /contexts/me/');
      return { name: 'Lan' };
    });
  }, [fail, run]);
  const state = useSyncExternalStore(
    (cb) => {
      const off = ctx.subscribe(cb);
      return () => void off();
    },
    () => ctx.state,
  );

  // StrictMode chạy effect hai lần ở dev: chỉ khởi động một lần cho mỗi ctx
  const startedFor = useRef<typeof ctx | null>(null);
  useEffect(() => {
    if (startedFor.current === ctx) return;
    startedFor.current = ctx;
    setUdemyLoading(true);
    setEarly('');
    try {
      void ctx.data.name; // đọc trước khi có dữ liệu: ném lỗi rõ ràng
    } catch (e) {
      setEarly((e as Error).message);
    }
    void ctx.start();
    // kiểu Udemy: isGlobalMeContextLoading chỉ về false khi request thành công
    void (async () => {
      await sleep(400);
      if (fail) return; // lỗi: không ai gán lại false
      setUdemyLoading(false);
    })();
  }, [ctx, fail]);

  return (
    <section className='card ud-al'>
      <h2>3. HTML cache công khai, dữ liệu người dùng tới sau</h2>
      <p className='hint'>
        Trang được cache chung cho mọi người, phần "Xin chào, …" chờ API <code>/contexts/me/</code>. Request lỗi: kiểu
        Udemy giữ cờ "đang tải" mãi; bản viết lại chuyển sang lỗi và cho thử lại.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={fail} onChange={(e) => setFail(e.target.checked)} /> Lần gọi đầu bị lỗi
        </label>
        <button onClick={() => setRun((r) => r + 1)}>Tải lại trang</button>
      </div>
      {early && <p className='muted'>Đọc sớm: {early}</p>}
      <div className='split'>
        <div className='ud-al-header' data-testid='late-udemy'>
          Kiểu Udemy: {udemyLoading ? <span className='spinner' aria-label='đang tải' /> : 'Xin chào, Lan'}
        </div>
        <div className='ud-al-header' data-testid='late-rewrite'>
          Viết lại:{' '}
          {state === 'loading' && <span className='spinner' aria-label='đang tải' />}
          {state === 'loaded' && `Xin chào, ${ctx.data.name}`}
          {state === 'error' && (
            <>
              <span className='err'>Lỗi</span> <button onClick={() => void ctx.retry()}>Thử lại</button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

export default function UdAppLoaderDemo() {
  return (
    <div className='page'>
      <h1>Nạp app theo ưu tiên, registry store, context tới muộn</h1>
      <LoaderSection />
      <RegistrySection />
      <LateSection />
    </div>
  );
}

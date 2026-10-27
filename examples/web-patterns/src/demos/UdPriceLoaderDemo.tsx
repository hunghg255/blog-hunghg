import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Log, Stat, sleep, useLog } from './shared';
import { createBatchLoader, createComponentContextStore, type Entry } from '../lib/udPriceLoader';
import { createUdemyStylePriceStore } from './UdPriceUdemyStyle';
import './UdPriceLoaderDemo.css';

// ---------------------------------------------------------------- 1. gom request giá

const COURSE_IDS = [3, 25, 100, 1024, 207, 9, 88, 4512, 61, 330, 12, 7, 1500, 42, 999, 5, 260, 18, 73, 2048, 1, 640, 150, 31];
const price = (id: number) => `${((199 + (id % 7) * 50) * 1000).toLocaleString("vi-VN")}₫`;

type Mode = 'each' | 'udemy' | 'rewrite';

interface PriceSource {
  load: (id: number) => void;
  get: (id: number) => Entry<string> | undefined;
  dispose: () => void;
}

function PriceSection() {
  const [mode, setMode] = useState<Mode>('rewrite');
  const [dropIds, setDropIds] = useState(true);
  // cấu hình được "chốt" lúc bấm Tải trang, đổi nút chế độ không tự chạy lại
  const [run, setRun] = useState<{ n: number; mode: Mode; dropIds: boolean }>({ n: 0, mode: 'rewrite', dropIds: true });
  const [visible, setVisible] = useState<number[]>([]);
  const [requests, setRequests] = useState(0);
  const [urls, setUrls] = useState<string[]>([]);
  const [, force] = useState(0);
  const log = useLog(6);

  // server giả: trả về đúng các id được hỏi, trừ hai id nếu bật "server bỏ sót"
  const source = useMemo<PriceSource | null>(() => {
    if (run.n === 0) return null;
    const { mode, dropIds } = run;
    const missing = dropIds ? new Set([1024, 61]) : new Set<number>();
    let count = 0;
    let alive = true; // response của lần chạy cũ không được ghi vào số liệu của lần mới
    const fetchBatch = async (ids: number[]) => {
      count++;
      if (alive) {
        setRequests(count);
        setUrls((u) => (u.length < 3 ? [...u, ids.join(',')] : u));
      }
      await sleep(300);
      const out: Record<number, string> = {};
      ids.forEach((id) => {
        if (!missing.has(id)) out[id] = price(id);
      });
      return out;
    };
    const rerender = () => alive && force((n) => n + 1);
    const dispose = () => {
      alive = false;
    };
    if (mode === 'udemy') {
      const store = createUdemyStylePriceStore(fetchBatch, rerender);
      return { load: store.registerCourse, get: store.get, dispose };
    }
    if (mode === 'each') {
      const map = new Map<number, Entry<string>>();
      return {
        load(id) {
          map.set(id, { status: 'loading' });
          rerender();
          fetchBatch([id]).then((r) => {
            map.set(id, id in r ? { status: 'loaded', value: r[id] } : { status: 'error' });
            rerender();
          });
        },
        get: (id) => map.get(id),
        dispose,
      };
    }
    const loader = createBatchLoader<string>({ fetchBatch });
    loader.subscribe(rerender);
    return { load: loader.load, get: loader.get, dispose };
  }, [run]);

  // card "cuộn vào màn hình" lần lượt, mỗi card đăng ký giá khi mount
  useEffect(() => {
    if (!source) return;
    setVisible([]);
    setRequests(0);
    setUrls([]);
    let i = 0;
    const t = setInterval(() => {
      const id = COURSE_IDS[i++];
      source.load(id);
      setVisible((v) => [...v, id]);
      if (i >= COURSE_IDS.length) clearInterval(t);
    }, 20);
    const report = setTimeout(() => {
      const stuck = COURSE_IDS.filter((id) => source.get(id)?.status === 'loading').length;
      log.add(
        `${run.mode === 'each' ? 'Mỗi thẻ 1 request' : run.mode === 'udemy' ? 'Kiểu Udemy' : 'Viết lại'}: sau 2 giây còn ${stuck} thẻ "đang tải"`,
        stuck ? 'err' : 'ok',
      );
    }, 2000);
    return () => {
      clearInterval(t);
      clearTimeout(report);
      source.dispose();
    };
  }, [source, run, log.add]);

  const stuck = visible.filter((id) => source?.get(id)?.status === 'loading').length;

  return (
    <section className='card ud-pl'>
      <h2>1. 24 thẻ khoá học, mỗi thẻ cần giá</h2>
      <p className='hint'>
        Thẻ mount cách nhau 20ms. Gom trong 250ms, tối đa 10 id mỗi request. Bật "server bỏ sót" để thấy thẻ của
        kiểu Udemy kẹt "đang tải".
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        {(
          [
            ['each', 'Mỗi thẻ 1 request'],
            ['udemy', 'Kiểu Udemy'],
            ['rewrite', 'Viết lại'],
          ] as const
        ).map(([m, label]) => (
          <button key={m} className={mode === m ? 'primary' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
        <label className='switch'>
          <input type='checkbox' checked={dropIds} onChange={(e) => setDropIds(e.target.checked)} /> Server bỏ sót id 1024 và 61
        </label>
        <button className='primary' onClick={() => setRun((r) => ({ n: r.n + 1, mode, dropIds }))} data-testid='pl-run'>
          Tải trang
        </button>
      </div>
      <div className='stats'>
        <Stat label='Request giá' value={<bdi data-testid='pl-requests'>{requests}</bdi>} />
        <Stat label='Thẻ đang tải' value={<bdi data-testid='pl-stuck'>{stuck}</bdi>} />
      </div>
      {urls.length > 0 && (
        <p className='ud-pl-urls'>
          course_ids của các lô đầu: {urls.map((u) => <code key={u}>{u}</code>)}
        </p>
      )}
      <div className='ud-pl-grid'>
        {visible.map((id) => {
          const e = source?.get(id);
          return (
            <div key={id} className={`ud-pl-card ud-pl-${e?.status ?? 'loading'}`} data-testid={`pl-card-${id}`}>
              <small className='muted'>#{id}</small>
              <b>{e?.status === 'loaded' ? e.value : e?.status === 'error' ? 'Lỗi giá' : 'Đang tải…'}</b>
            </div>
          );
        })}
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 2. cập nhật một phần khi áp mã

const ALL_COMPONENTS = ['lede', 'rating', 'curriculum', 'buy_button', 'purchase', 'redeem_coupon', 'discount_expiration'];
const COMPONENTS_TO_UPDATE = ['buy_button', 'purchase', 'redeem_coupon', 'discount_expiration'];
const DISCOUNT: Record<string, number> = { '': 0, GIAM10: 10, GIAM50: 50 };
// mã có điều kiện phức tạp hơn thì server tính lâu hơn
const LATENCY: Record<string, number> = { '': 150, GIAM10: 900, GIAM50: 200 };

type Ctx = { text: string };

// memo: khối chỉ render lại khi context CỦA NÓ đổi, không phải mỗi lần cha render
const Block = memo(function Block({ store, name }: { store: ReturnType<typeof createComponentContextStore<Ctx>>; name: string }) {
  const ctx = useSyncExternalStore(
    (cb) => store.subscribe(name, cb),
    () => store.get(name),
  );
  const renders = useRef(0);
  renders.current++;
  return (
    <div className={`ud-pl-block ${COMPONENTS_TO_UPDATE.includes(name) ? 'ud-pl-dynamic' : ''}`}>
      <code>{name}</code>
      <span data-testid={`blk-${name}`}>{ctx?.text ?? '…'}</span>
      <small className='muted' data-testid={`blk-renders-${name}`}>render: {renders.current}</small>
    </div>
  );
});

function CouponSection() {
  const [latestWins, setLatestWins] = useState(true);
  const [busy, setBusy] = useState(false);
  const log = useLog(6);

  const store = useMemo(
    () =>
      createComponentContextStore<Ctx>({
        latestWins,
        async fetchComponents(names, params) {
          const code = params.discountCode ?? '';
          await sleep(LATENCY[code] ?? 300);
          const base = 1_999_000;
          const final = Math.round((base * (100 - (DISCOUNT[code] ?? 0))) / 100);
          const out: Record<string, Ctx> = {};
          for (const n of names) {
            out[n] = {
              text:
                n === 'purchase' || n === 'buy_button'
                  ? `${final.toLocaleString('vi-VN')}₫${code ? ` (${code})` : ''}`
                  : n === 'redeem_coupon'
                    ? code || 'chưa có mã'
                    : n === 'discount_expiration'
                      ? code ? 'Hết hạn sau 2 ngày' : '—'
                      : n === 'lede'
                        ? 'React từ cơ bản đến nâng cao'
                        : n === 'rating'
                          ? '4,7 ★ (12.345)'
                          : '42 bài, 18 giờ',
            };
          }
          return out;
        },
      }),
    [latestWins],
  );

  useEffect(() => {
    void store.populate(ALL_COMPONENTS);
  }, [store]);

  const apply = async (code: string) => {
    const r = await store.populate(COMPONENTS_TO_UPDATE, { discountCode: code });
    log.add(`${code}: cập nhật ${r.applied.length} khối${r.stale ? `, bỏ ${r.stale} khối vì đã có mã mới hơn` : ''}`, r.stale ? 'warn' : 'ok');
  };

  const race = async () => {
    setBusy(true);
    const a = apply('GIAM10'); // server tính lâu
    await sleep(50);
    const b = apply('GIAM50'); // người dùng đổi ý, mã này về trước
    await Promise.all([a, b]);
    setBusy(false);
  };

  return (
    <section className='card ud-pl'>
      <h2>2. Áp mã giảm giá: chỉ tải lại vài khối</h2>
      <p className='hint'>
        Trang khoá học gồm nhiều khối, mỗi khối có context riêng. Áp mã chỉ tải lại 4 khối liên quan tới giá (viền
        tím); số render của các khối khác đứng yên. "Đổi mã liên tiếp" áp GIAM10 (server trả sau 900ms) rồi GIAM50
        (200ms): không có "lần gọi mới nhất thắng" thì giá cuối cùng là của GIAM10.
      </p>
      <div className='toolbar'>
        <button onClick={() => apply('GIAM10')} disabled={busy}>Áp GIAM10</button>
        <button onClick={() => apply('GIAM50')} disabled={busy}>Áp GIAM50</button>
        <button className='primary' onClick={race} disabled={busy} data-testid='pl-race'>
          Đổi mã liên tiếp
        </button>
        <label className='switch'>
          <input type='checkbox' checked={latestWins} onChange={(e) => setLatestWins(e.target.checked)} /> Lần gọi mới nhất thắng
        </label>
      </div>
      <div className='ud-pl-blocks'>
        {ALL_COMPONENTS.map((n) => (
          <Block key={`${n}-${latestWins}`} store={store} name={n} />
        ))}
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

export default function UdPriceLoaderDemo() {
  return (
    <div className='page'>
      <h1>Gom request giá, cập nhật một phần khi áp mã</h1>
      <PriceSection />
      <CouponSection />
    </div>
  );
}

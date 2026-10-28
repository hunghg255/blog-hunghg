import { useEffect, useMemo, useRef, useState } from 'react';
import {
  composeResults,
  normalizeQuery,
  PrefixCache,
  releaseScrollLock,
  scrollItemToCenter,
  wordPrefixMatch,
  type CacheHit,
  type SourceSnapshot,
} from '../lib/stableTypeahead';
import { Log, Stat, sleep, useLog } from './shared';
import './StableTypeaheadDemo.css';

interface Person {
  id: string;
  name: string;
}
const HO = ['Nguyễn', 'Trần', 'Lê', 'Phạm', 'Hoàng', 'Đặng', 'Vũ', 'Bùi'];
const TEN = ['An', 'Anh', 'Ánh', 'Bình', 'Châu', 'Dũng', 'Hà', 'Hải', 'Hân', 'Khoa', 'Lan', 'Minh', 'Ngọc', 'Nam', 'Thảo'];
const PEOPLE: Person[] = HO.flatMap((h, i) =>
  TEN.filter((_, j) => (i + j) % 2 === 0).map((t, j) => ({ id: `p${i}-${j}`, name: `${h} ${t}` })),
);
const LIMIT = 6;

type Section = 'cache' | 'compose' | 'scroll';

export default function StableTypeaheadDemo() {
  const [section, setSection] = useState<Section>('cache');
  return (
    <div className='page ta-demo'>
      <h1>Typeahead không nhảy</h1>
      <div className='ta-switch' role='tablist'>
        {(
          [
            ['cache', 'Cache theo tiền tố'],
            ['compose', 'Ghép nhiều nguồn'],
            ['scroll', 'Cuộn bằng phím'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role='tab'
            aria-selected={section === id}
            className={section === id ? 'primary' : ''}
            onClick={() => setSection(id)}
            data-testid={`sec-${id}`}
          >
            {label}
          </button>
        ))}
      </div>
      {section === 'cache' && <CachePanel />}
      {section === 'compose' && <ComposePanel />}
      {section === 'scroll' && <ScrollPanel />}
    </div>
  );
}

// ---------------------------------------------------------------- cache

function CachePanel() {
  const { lines, add } = useLog();
  const [legacy, setLegacy] = useState(false);
  const cache = useMemo(
    () => new PrefixCache<Person>({ id: (p) => p.id, label: (p) => p.name, legacyKeys: legacy }),
    [legacy],
  );
  const [q, setQ] = useState('');
  const [hit, setHit] = useState<CacheHit<Person>>({ entries: [], via: 'miss' });
  const [calls, setCalls] = useState(0);
  const [, bump] = useState(0);
  const latest = useRef('');

  const fetchPeople = async (query: string) => {
    setCalls((c) => c + 1);
    await sleep(350);
    const nq = normalizeQuery(query);
    return PEOPLE.filter((p) => wordPrefixMatch(p.name, nq)).slice(0, LIMIT);
  };

  const search = async (value: string) => {
    setQ(value);
    latest.current = value;
    if (!value.trim()) return setHit({ entries: [], via: 'miss' });
    const h = cache.match(value);
    setHit(h);
    if (h.via === 'exact') return add(`"${value}": trúng cache, không gọi mạng`, 'ok');
    add(h.via === 'narrowed' ? `"${value}": thu hẹp từ "${h.from}" (${h.entries.length} mục), vẫn hỏi mạng` : `"${value}": chưa có gì, hỏi mạng`);
    const net = await fetchPeople(value);
    cache.add(value, net);
    bump((x) => x + 1);
    if (latest.current === value) setHit(cache.match(value));
  };

  const retype = async () => {
    for (let i = 0; i < 3; i++) {
      await search('');
      await search('an ');
      await sleep(50);
    }
  };

  return (
    <>
      <p className='hint'>
        Mỗi query đã hỏi được lưu lại. Gõ thêm chữ thì lọc ngay trên kết quả của tiền tố dài nhất đã
        có (không chờ mạng), rồi trộn kết quả mạng vào <b>phía sau</b>. Mạng trả tối đa {LIMIT} mục nên
        vẫn phải hỏi: kết quả thu hẹp có thể thiếu.
      </p>
      <div className='toolbar ta-wrap'>
        <input
          className='ta-input'
          value={q}
          onChange={(e) => search(e.target.value)}
          placeholder='Gõ "ng", "ngu", "an"…'
          data-testid='q'
        />
        <label className='ta-check'>
          <input
            type='checkbox'
            checked={legacy}
            onChange={(e) => {
              setLegacy(e.target.checked);
              setCalls(0);
              setHit({ entries: [], via: 'miss' });
            }}
            data-testid='legacy'
          />
          Key bản gốc (ghi trimStart, đọc trim)
        </label>
        <button onClick={retype} data-testid='retype'>
          Gõ lại "an␣" 3 lần
        </button>
      </div>
      <div className='stats'>
        <Stat label='lần gọi mạng' value={<output data-testid='calls'>{calls}</output>} />
        <Stat label='nguồn kết quả' value={<output data-testid='via'>{hit.via}</output>} />
        <Stat label='key trong cache' value={cache.keys().length} />
      </div>
      <div className='ta-cols'>
        <ul className='ta-results' data-testid='results'>
          {hit.entries.map((p) => (
            <li key={p.id}>{p.name}</li>
          ))}
        </ul>
        <div className='ta-keys'>
          {cache.keys().map((k) => (
            <code key={k}>{JSON.stringify(k)}</code>
          ))}
        </div>
      </div>
      <Log lines={lines} />
    </>
  );
}

// ---------------------------------------------------------------- compose

interface Item {
  id: string;
  label: string;
  src: string;
}
const SOURCES = [
  { name: 'Bạn bè', ms: 900, items: ['An Nguyễn', 'An Trần', 'Anh Lê'] },
  { name: 'Nhóm', ms: 400, items: ['Ăn gì hôm nay', 'An toàn giao thông'] },
  { name: 'Trang', ms: 150, items: ['An Phát Holdings', 'Ana Mart'] },
];

function useComposite(opts: { allowReflow?: boolean; legacyPending?: boolean; activeFirst?: boolean }) {
  const [shown, setShown] = useState<Item[]>([]);
  const [stats, setStats] = useState({ updates: 0, pushedDown: 0, firstMs: 0 });
  const run = async () => {
    setShown([]);
    const t0 = performance.now();
    let prev: Item[] = [];
    let updates = 0;
    let pushedDown = 0;
    let firstMs = 0;
    const snaps: SourceSnapshot<Item>[] = SOURCES.map(() => ({
      status: opts.activeFirst ? 'active' : 'pending',
      results: [],
    }));
    const emit = () => {
      const r = composeResults(snaps, (e) => e.id, opts);
      if (!r.emit) return;
      // mục đã hiện mà bị đẩy xuống vị trí thấp hơn
      for (const e of prev) {
        const before = prev.indexOf(e);
        const after = r.results.findIndex((x) => x.id === e.id);
        if (after > before) pushedDown++;
      }
      if (!firstMs && r.results.length) firstMs = Math.round(performance.now() - t0);
      prev = r.results;
      updates++;
      setShown(r.results);
      setStats({ updates, pushedDown, firstMs });
    };
    await Promise.all(
      SOURCES.map(async (s, i) => {
        await sleep(s.ms);
        snaps[i] = { status: 'complete', results: s.items.map((label) => ({ id: label, label, src: s.name })) };
        emit();
      }),
    );
  };
  return { shown, stats, run };
}

function ComposeColumn({ title, c, id }: { title: string; c: ReturnType<typeof useComposite>; id: string }) {
  return (
    <div className='card ta-compose' data-testid={`col-${id}`}>
      <b>{title}</b>
      <ul className='ta-results'>
        {c.shown.map((e) => (
          <li key={e.id}>
            {e.label} <span className='badge'>{e.src}</span>
          </li>
        ))}
      </ul>
      <small>
        cập nhật <output data-testid={`updates-${id}`}>{c.stats.updates}</output> lần · mục bị đẩy xuống{' '}
        <output data-testid={`pushed-${id}`}>{c.stats.pushedDown}</output> · hiện lần đầu sau {c.stats.firstMs}ms
      </small>
    </div>
  );
}

function ComposePanel() {
  const naive = useComposite({ allowReflow: true });
  const legacy = useComposite({ legacyPending: true });
  const guarded = useComposite({});
  return (
    <>
      <p className='hint'>
        Ba nguồn trả về theo thứ tự ngược với thứ tự hiển thị: Bạn bè 900ms, Nhóm 400ms, Trang 150ms.
        Cột giữa là luật của bản gốc khi các nguồn không báo "đang chạy" trước: nguồn chưa trả lần nào
        không chặn được gì.
      </p>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={() => {
            naive.run();
            legacy.run();
            guarded.run();
          }}
          data-testid='compose-run'
        >
          Tìm "an"
        </button>
      </div>
      <div className='ta-compose-cols'>
        <ComposeColumn title='Hiện ngay khi có' c={naive} id='naive' />
        <ComposeColumn title='Luật gốc, nguồn chưa báo' c={legacy} id='legacy' />
        <ComposeColumn title='Chờ nguồn phía trên' c={guarded} id='guarded' />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- scroll

const ROWS = Array.from({ length: 200 }, (_, i) => `Kết quả số ${i + 1}`);

function ScrollPanel() {
  const [lock, setLock] = useState(true);
  const [active, setActive] = useState(0);
  const [steals, setSteals] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const lastKey = useRef(0);

  useEffect(() => {
    const list = listRef.current!;
    const item = list.children[active] as HTMLElement | undefined;
    if (item) scrollItemToCenter(list, item, lock ? 100 : 0);
  }, [active, lock]);
  useEffect(() => {
    const list = listRef.current!;
    return () => releaseScrollLock(list);
  }, []);

  return (
    <>
      <p className='hint'>
        Đặt chuột lên danh sách, rồi bấm vào danh sách và giữ <kbd>↓</kbd>. Danh sách cuộn để mục đang
        chọn nằm giữa; nội dung trượt dưới con trỏ đứng yên làm trình duyệt bắn mouseenter. Không khoá
        thì hover "cướp" mục đang chọn.
      </p>
      <div className='toolbar ta-wrap'>
        <label className='ta-check'>
          <input type='checkbox' checked={lock} onChange={(e) => setLock(e.target.checked)} data-testid='lock' />
          Tắt pointer-events 100ms khi cuộn
        </label>
        <button onClick={() => (setSteals(0), setActive(0))}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='mục đang chọn' value={<output data-testid='active'>{active + 1}</output>} />
        <Stat label='lần hover cướp mục chọn' value={<output data-testid='steals'>{steals}</output>} />
      </div>
      <ul
        ref={listRef}
        className='ta-list'
        tabIndex={0}
        role='listbox'
        aria-label='Kết quả'
        aria-activedescendant={`row-${active}`}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          lastKey.current = performance.now();
          setActive((a) => Math.max(0, Math.min(ROWS.length - 1, a + (e.key === 'ArrowDown' ? 1 : -1))));
        }}
        data-testid='list'
      >
        {ROWS.map((r, i) => (
          <li
            key={r}
            id={`row-${i}`}
            role='option'
            aria-selected={i === active}
            className={i === active ? 'on' : ''}
            onMouseEnter={() => {
              if (i === active) return;
              if (performance.now() - lastKey.current < 400) setSteals((s) => s + 1);
              setActive(i);
            }}
          >
            {r}
          </li>
        ))}
      </ul>
    </>
  );
}

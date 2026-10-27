import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRequestRegistry, createSuggestStore, isAbortError } from '../lib/searchBox';
import { highlightTerms } from '../lib/searchHighlight';
import { Log, Stat, sleep, useLog } from './shared';
import './SearchBoxDemo.css';

const COURSES = [
  'React từ cơ bản đến nâng cao',
  'React Native: làm app di động',
  'React Query và cache dữ liệu',
  'Redux Toolkit thực chiến',
  'Node.js và Express',
  'ASP.NET Core Web API',
  '.NET 8 cho người mới',
  'Next.js App Router',
  'TypeScript cho dev React',
  'Tiếng Việt cho lập trình viên',
  'Vue 3 Composition API',
  'Python cho phân tích dữ liệu',
  'Pottery: làm gốm cơ bản',
  'Harry Potter và phép thuật CSS',
  'Despotism trong lịch sử',
  'C# và Unity',
  'Rust: an toàn bộ nhớ',
  'Go cho backend',
  'GraphQL với Apollo',
  'Docker và Kubernetes',
  'Tối ưu hiệu năng web',
  'Web Accessibility (a11y)',
];

/** API giả: trả kết quả sau 120–900ms ngẫu nhiên, nên câu trả lời có thể về sai thứ tự. */
function fakeSearch(query: string, signal?: AbortSignal) {
  return new Promise<string[]>((resolve, reject) => {
    const delay = 120 + Math.random() * 780;
    const timer = setTimeout(() => {
      const q = query.toLowerCase();
      // khớp nhiều từ hơn thì xếp trước
      const score = (c: string) => highlightTerms(c, q).filter((s) => s.match).length;
      resolve(
        COURSES.filter((c) => score(c) > 0)
          .sort((a, b) => score(b) - score(a))
          .slice(0, 6),
      );
    }, delay);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightTerms(text, query).map((s, i) => (s.match ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>))}
    </>
  );
}

interface Counters {
  request: number;
  abort: number;
  cacheHit: number;
  stale: number;
}
const ZERO: Counters = { request: 0, abort: 0, cacheHit: 0, stale: 0 };

/**
 * Bản "ngây thơ": mỗi phím một request, không huỷ, ai về sau thắng.
 * Giữ bản sao trong ref để handler bàn phím (kể cả nút tự gõ) luôn đọc giá trị mới nhất.
 */
function useNaiveSearch(onStale: () => void, onRequest: () => void) {
  const [, rerender] = useState(0);
  const ref = useRef({ input: '', items: [] as string[], shownQuery: '', active: -1 });
  const update = (patch: Partial<typeof ref.current>) => {
    ref.current = { ...ref.current, ...patch };
    rerender((n) => n + 1);
  };
  const change = (value: string) => {
    update({ input: value });
    const q = value.trim();
    if (!q) return update({ items: [], shownQuery: '', active: -1 });
    onRequest();
    void fakeSearch(q).then((res) => {
      if (q !== ref.current.input.trim()) onStale(); // kết quả của query cũ đè lên
      update({ items: res, shownQuery: q, active: -1 });
    });
  };
  const move = (delta: number) =>
    update({ active: Math.max(-1, Math.min(ref.current.items.length - 1, ref.current.active + delta)) });
  return { get: () => ref.current, change, move };
}

export default function SearchBoxDemo() {
  const [mode, setMode] = useState<'naive' | 'pro'>('pro');
  const [counters, setCounters] = useState<Counters>(ZERO);
  const bump = (key: keyof Counters) => setCounters((c) => ({ ...c, [key]: c[key] + 1 }));
  const { lines, add } = useLog();

  const store = useMemo(
    () =>
      createSuggestStore<string>({
        load: (q, signal) => fakeSearch(q, signal),
        debounceMs: 200,
        onEvent: (event) => bump(event === 'cache-hit' ? 'cacheHit' : event),
      }),
    [],
  );
  useEffect(() => store.dispose, [store]);
  const pro = useSyncExternalStore(store.subscribe, store.getState);
  const naive = useNaiveSearch(
    () => bump('stale'),
    () => bump('request'),
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const view =
    mode === 'pro'
      ? { input: pro.input, items: pro.items, shownQuery: pro.shownQuery, active: pro.activeIndex, stable: pro.stable }
      : { ...naive.get(), stable: true };

  const onChange = (value: string) => (mode === 'pro' ? store.setInput(value) : naive.change(value));

  const onKeyDown = (key: string, preventDefault = () => {}) => {
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      preventDefault();
      const delta = key === 'ArrowDown' ? 1 : -1;
      if (mode === 'pro') {
        if (!store.move(delta)) add('↓↑ bị khoá: kết quả chưa khớp với ô nhập', 'warn');
      } else {
        naive.move(delta);
      }
    }
    if (key === 'Enter') {
      if (mode === 'pro') {
        const result = store.enter();
        if (result.type === 'item') add(`Chọn: ${result.item}`, 'ok');
        else add(`Gửi câu tìm kiếm "${result.query}" (không chọn nhầm gợi ý cũ)`, 'ok');
      } else {
        const { items, active, input, shownQuery } = naive.get();
        const item = items[active];
        const typed = input.trim();
        if (item && shownQuery !== typed) add(`Chọn NHẦM: "${item}" (gợi ý của "${shownQuery}", đang gõ "${typed}")`, 'err');
        else if (item) add(`Chọn: ${item}`, 'ok');
        else add(`Gửi câu tìm kiếm "${typed}"`);
      }
    }
  };

  /** Gõ nhanh từng ký tự rồi bấm ↓ + Enter ngay, giống người gõ quen tay. */
  const autoType = async () => {
    onChange('');
    await sleep(50);
    const text = 'react native';
    for (let i = 1; i <= text.length; i++) {
      onChange(text.slice(0, i));
      await sleep(70);
    }
    onKeyDown('ArrowDown');
    onKeyDown('Enter');
  };

  // ---- huỷ hàng loạt khi chuyển trang ----
  const registry = useMemo(() => createRequestRegistry(), []);
  const [pendingWidgets, setPendingWidgets] = useState(0);
  const loadWidgets = () => {
    for (const name of ['Biểu đồ traffic', 'Top từ khoá', 'Đối thủ']) {
      setPendingWidgets((n) => n + 1);
      registry
        .run(async (signal) => {
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 3000);
            signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
          });
          return name;
        })
        .then((n) => add(`Widget "${n}" tải xong`, 'ok'))
        .catch((e) => add(isAbortError(e) ? `Widget "${name}" đã huỷ` : String(e), 'muted'))
        .finally(() => setPendingWidgets((n) => n - 1));
    }
  };

  return (
    <div className='page sb-page'>
      <h1>Ô tìm kiếm chuẩn production</h1>
      <p className='hint'>
        API giả trả lời sau 120–900ms ngẫu nhiên. Gõ nhanh (hoặc bấm nút tự gõ) rồi bấm ↓ và Enter thật nhanh.
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        <button className={mode === 'naive' ? 'primary' : ''} aria-pressed={mode === 'naive'} onClick={() => setMode('naive')}>
          Ngây thơ: mỗi phím một request
        </button>
        <button className={mode === 'pro' ? 'primary' : ''} aria-pressed={mode === 'pro'} onClick={() => setMode('pro')}>
          Production: debounce + abort + cache + khoá phím
        </button>
        <button onClick={() => void autoType()}>⌨ Tự gõ "react native" + ↓ + Enter</button>
        <button onClick={() => setCounters(ZERO)}>Xoá số đếm</button>
      </div>

      <div className='sb-box'>
        <input
          ref={inputRef}
          type='text'
          role='combobox'
          aria-expanded={view.items.length > 0}
          aria-controls='sb-list'
          aria-activedescendant={view.active >= 0 ? `sb-opt-${view.active}` : undefined}
          aria-label='Tìm khoá học'
          placeholder='Tìm khoá học… (thử: net, pot, react)'
          value={view.input}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => onKeyDown(e.key, () => e.preventDefault())}
        />
        <span className={`badge ${view.stable ? 'ok' : 'warn'}`}>{view.stable ? 'đã chốt' : 'đang chờ…'}</span>
        <ul id='sb-list' role='listbox' className={view.stable ? '' : 'sb-dim'}>
          {view.items.map((item, i) => (
            <li key={item} id={`sb-opt-${i}`} role='option' aria-selected={i === view.active} className={i === view.active ? 'active' : ''}>
              <Highlighted text={item} query={view.shownQuery} />
            </li>
          ))}
          {view.items.length === 0 && view.input.trim() && view.stable && <li className='muted'>Không có kết quả</li>}
        </ul>
      </div>

      <div className='stats'>
        <Stat label='request gửi đi' value={counters.request} />
        <Stat label='request bị huỷ' value={counters.abort} />
        <Stat label='lấy từ cache' value={counters.cacheHit} />
        <Stat label='lần hiện kết quả của query cũ' value={<span className={counters.stale ? 'err' : ''}>{counters.stale}</span>} />
      </div>

      <div className='card'>
        <h2>Huỷ mọi request khi chuyển trang</h2>
        <div className='toolbar'>
          <button onClick={loadWidgets}>Tải 3 widget (mỗi cái 3 giây)</button>
          <button
            onClick={() => {
              const n = registry.abortAll();
              add(`Chuyển trang: huỷ ${n} request đang chạy`, n ? 'warn' : 'muted');
            }}
          >
            Chuyển trang (abortAll)
          </button>
          <span className='muted'>đang chạy: {pendingWidgets}</span>
        </div>
      </div>
      <Log lines={lines} />
    </div>
  );
}

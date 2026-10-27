import { useMemo, useRef, useState } from 'react';
import { LinkedLru, LruMap } from '../lib/lruCache';
import { ArrayLru, NaiveMapLru } from './LruCacheBaselines';
import { Log, Stat, useLog } from './shared';
import './LruCacheDemo.css';

const MAILS = ['A', 'B', 'C', 'D', 'E', 'F'];
const MAX = 3;

export default function LruCacheDemo() {
  return (
    <div className='page lru'>
      <h1>LRU cache theo 3 cách</h1>
      <Playground />
      <PitfallDemo />
      <Benchmark />
    </div>
  );
}

/** Mở thư như trong hộp thư: cache giữ tối đa 3 thư, thư đang mở được ghim. */
function Playground() {
  const pinned = useRef(new Set<string>());
  const log = useLog(12);
  const [, rerender] = useState(0);
  const cache = useMemo(
    () =>
      new LruMap<string, string>({
        max: MAX,
        isPinned: (key) => pinned.current.has(key),
        onEvict: (key) => log.add(`đẩy thư ${key} ra khỏi cache`, 'warn'),
      }),
    [log.add],
  );
  const [stats, setStats] = useState({ hit: 0, miss: 0 });

  const open = (id: string) => {
    if (cache.get(id) !== undefined) {
      setStats((s) => ({ ...s, hit: s.hit + 1 }));
      log.add(`mở thư ${id}: có sẵn trong cache`, 'ok');
    } else {
      setStats((s) => ({ ...s, miss: s.miss + 1 }));
      log.add(`mở thư ${id}: tải từ server`);
      cache.set(id, `Nội dung thư ${id}`);
    }
    rerender((n) => n + 1);
  };
  const togglePin = (id: string) => {
    if (pinned.current.has(id)) pinned.current.delete(id);
    else pinned.current.add(id);
    rerender((n) => n + 1);
  };

  return (
    <section>
      <h2>1. Thử như trong hộp thư (tối đa {MAX} thư, LruMap)</h2>
      <p className='hint'>
        Bấm để mở thư. Ghim một thư (giống thư đang mở ở khung đọc của Outlook) thì nó không bị đẩy ra, kể cả khi
        cache đã đầy.
      </p>
      <div className='lru-mails'>
        {MAILS.map((id) => (
          <div key={id} className={`lru-mail ${cache.has(id) ? 'in' : ''}`}>
            <button onClick={() => open(id)}>Mở {id}</button>
            <label>
              <input type='checkbox' checked={pinned.current.has(id)} onChange={() => togglePin(id)} /> ghim
            </label>
          </div>
        ))}
      </div>
      <div className='stats'>
        <Stat label='thứ tự trong cache (cũ → mới)' value={cache.keys().join(' → ') || '(trống)'} />
        <Stat label='có sẵn / phải tải' value={`${stats.hit} / ${stats.miss}`} />
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

/** Cạm bẫy: Map.set với key đã có không đổi vị trí. */
function PitfallDemo() {
  const run = () => {
    const naive = new NaiveMapLru<string, number>(3);
    const fixed = new LruMap<string, number>({ max: 3 });
    for (const c of [naive, fixed]) {
      c.set('a', 1).set('b', 1).set('c', 1);
      c.set('a', 2); // cập nhật a: a giờ là mới dùng nhất
      c.set('d', 1); // cache đầy: phải đẩy b ra
    }
    return { naive: [...naive.keys()], fixed: fixed.keys() };
  };
  const [result, setResult] = useState<ReturnType<typeof run> | null>(null);

  return (
    <section>
      <h2>2. Cạm bẫy: cập nhật giá trị mà quên đổi thứ tự</h2>
      <p className='hint'>
        Ghi a, b, c rồi <b>cập nhật</b> a, sau đó ghi d. Đúng ra b mới là key lâu chưa dùng nhất.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => setResult(run())}>
          Chạy
        </button>
      </div>
      {result && (
        <div className='stats'>
          <Stat label='set() không xoá key trước (kiểu LruMap của Apple)' value={<span className='err'>{result.naive.join(', ')}</span>} />
          <Stat label='xoá rồi chèn lại' value={<span className='ok'>{result.fixed.join(', ')}</span>} />
        </div>
      )}
    </section>
  );
}

type Impl = 'array' | 'map' | 'linked';

function bench(impl: Impl, ops: number, capacity: number) {
  const cache =
    impl === 'array'
      ? new ArrayLru<number, number>(capacity)
      : impl === 'map'
        ? new LruMap<number, number>({ max: capacity })
        : new LinkedLru<number, number>({ max: capacity });
  // Dãy key cố định (sinh số giả ngẫu nhiên có seed) để ba cách chạy cùng một dữ liệu
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  let hits = 0;
  const start = performance.now();
  for (let i = 0; i < ops; i++) {
    const key = Math.floor(rand() * capacity * 1.25);
    if (cache.get(key) !== undefined) hits++;
    else cache.set(key, i);
  }
  return { ms: performance.now() - start, hits, last: cache.keys().slice(-3).join(',') };
}

function Benchmark() {
  const [capacity, setCapacity] = useState(10000);
  const [rows, setRows] = useState<Array<{ impl: Impl; ms: number; hits: number; last: string }>>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setRows([]);
    const out: typeof rows = [];
    for (const impl of ['array', 'map', 'linked'] as const) {
      await new Promise((r) => setTimeout(r, 30)); // nhả luồng để UI kịp vẽ
      out.push({ impl, ...bench(impl, 100_000, capacity) });
      setRows([...out]);
    }
    setBusy(false);
  };
  const label: Record<Impl, string> = {
    array: 'Mảng + indexOf (kiểu Outlook MruCache)',
    map: 'Thứ tự chèn của Map (kiểu Apple)',
    linked: 'Danh sách liên kết đôi + Map (kiểu Similarweb)',
  };

  return (
    <section>
      <h2>3. Đo tốc độ: 100.000 lần đọc/ghi</h2>
      <div className='toolbar'>
        <label>
          Sức chứa{' '}
          <select value={capacity} onChange={(e) => setCapacity(Number(e.target.value))}>
            {[50, 500, 5000, 10000].map((n) => (
              <option key={n} value={n}>
                {n.toLocaleString('vi-VN')}
              </option>
            ))}
          </select>
        </label>
        <button className='primary' onClick={run} disabled={busy}>
          {busy ? 'Đang đo…' : 'Đo'}
        </button>
      </div>
      <table className='lru-table'>
        <tbody>
          {rows.map((r) => (
            <tr key={r.impl}>
              <td>{label[r.impl]}</td>
              <td>
                <b>{r.ms.toFixed(1)}ms</b>
              </td>
              <td className='muted'>
                trúng {r.hits.toLocaleString('vi-VN')} · 3 key mới nhất {r.last}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

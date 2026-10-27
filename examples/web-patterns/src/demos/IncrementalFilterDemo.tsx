import { useEffect, useRef, useState } from 'react';
import {
  compilePageRule,
  compileRegexRuleSlow,
  createIncrementalFilter,
  generatePages,
  type Page,
  type Rule,
} from '../lib/incrementalFilter';
import { createWorkerClient, type WorkerClient } from '../lib/workerRpc';
import { Stat } from './shared';
import './IncrementalFilterDemo.css';

const COUNT = 200_000;
const SEED = 7;
const LIMIT = 8;

type FilterApi = {
  load: (input: { count: number; seed: number }) => number;
  filter: (input: { rules: Rule[]; incremental: boolean; limit: number; matcher: Matcher }) => {
    count: number;
    scanned: number;
    reused: boolean;
    ms: number;
    top: string[];
  };
};

type Matcher = 'tokens' | 'regex';

const QUICK: Rule[] = [
  { mode: 'include', words: ['blog', 'docs'] },
  { mode: 'include', words: ['react'] },
  { mode: 'exclude', words: ['login'] },
  { mode: 'include', words: ['hooks', 'performance'] },
  { mode: 'exclude', words: ['sale', 'giày'] },
];

/** Đo frame dài nhất (khoảng cách giữa hai requestAnimationFrame) kể từ lần reset gần nhất. */
function useLongestFrame() {
  const longest = useRef(0);
  useEffect(() => {
    let last = performance.now();
    let id = requestAnimationFrame(function loop(now) {
      longest.current = Math.max(longest.current, now - last);
      last = now;
      id = requestAnimationFrame(loop);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return longest;
}

export default function IncrementalFilterDemo() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [incremental, setIncremental] = useState(true);
  const [where, setWhere] = useState<'worker' | 'main'>('worker');
  const [matcher, setMatcher] = useState<Matcher>('tokens');
  const [stats, setStats] = useState<null | { count: number; scanned: number; reused: boolean; ms: number; top: string[]; frame: number }>(null);
  const [draft, setDraft] = useState({ mode: 'include' as Rule['mode'], words: '' });
  const longest = useLongestFrame();

  // Tạo worker trong effect (không phải useMemo) để StrictMode mount-unmount-mount không dùng lại worker đã terminate
  const [client, setClient] = useState<WorkerClient<FilterApi> | null>(null);
  useEffect(() => {
    const c = createWorkerClient<FilterApi>(
      new Worker(new URL('../lib/incrementalFilter.worker.ts', import.meta.url), { type: 'module' }),
    );
    let alive = true;
    c.call('load', { count: COUNT, seed: SEED })
      .then(() => alive && setClient(c))
      .catch(() => {});
    return () => {
      alive = false;
      c.terminate();
      setClient(null);
    };
  }, []);
  const ready = client !== null;

  // Bản chạy trên luồng chính: chỉ sinh dữ liệu khi người dùng chọn chế độ này
  type MainFilter = ReturnType<typeof createIncrementalFilter<Page>>;
  const mainRef = useRef<{ pages: Page[]; filters: Record<Matcher, MainFilter> } | null>(null);

  const runSeq = useRef(0);
  useEffect(() => {
    if (!client) return;
    const seq = ++runSeq.current;
    // để trình duyệt vẽ xong frame hiện tại rồi mới bắt đầu đo
    const id = requestAnimationFrame(async () => {
      longest.current = 0;
      let out;
      if (where === 'worker') {
        try {
          out = await client.call('filter', { rules, incremental, limit: LIMIT, matcher });
        } catch {
          return; // worker đã bị terminate khi unmount
        }
      } else {
        if (!mainRef.current) {
          const pages = generatePages(COUNT, SEED);
          mainRef.current = {
            pages,
            filters: {
              tokens: createIncrementalFilter(pages, compilePageRule),
              regex: createIncrementalFilter(pages, compileRegexRuleSlow),
            },
          };
        }
        const start = performance.now();
        const run = mainRef.current.filters[matcher].run(rules, { incremental });
        out = { count: run.result.length, scanned: run.scanned, reused: run.reused, ms: performance.now() - start, top: run.result.slice(0, LIMIT).map((p) => p.url) };
      }
      // chờ thêm hai frame để đo được cả frame bị chặn
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (seq === runSeq.current) setStats({ ...out, frame: longest.current });
    });
    return () => cancelAnimationFrame(id);
  }, [rules, incremental, where, matcher, client, longest]);

  const addRule = (rule: Rule) => setRules((list) => [...list, rule]);
  const addDraft = () => {
    const words = draft.words.split(',').map((w) => w.trim()).filter(Boolean);
    if (words.length > 0) addRule({ mode: draft.mode, words });
    setDraft((d) => ({ ...d, words: '' }));
  };

  return (
    <div className='page ifl'>
      <h1>Lọc tăng dần trong Web Worker</h1>
      <p className='hint'>
        {COUNT.toLocaleString('vi-VN')} URL giả. Các điều kiện nối bằng VÀ, nên thêm điều kiện chỉ làm kết quả nhỏ
        đi: bộ lọc tăng dần chỉ quét lại kết quả lần trước. Bỏ một điều kiện cũ thì phải quét lại từ đầu.
      </p>

      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={incremental} onChange={(e) => setIncremental(e.target.checked)} /> Tái dùng kết quả lần trước
        </label>
        <label>
          Chạy ở{' '}
          <select value={where} onChange={(e) => setWhere(e.target.value as 'worker' | 'main')}>
            <option value='worker'>Web Worker</option>
            <option value='main'>Luồng chính</option>
          </select>
        </label>
        <label>
          Kiểm tra bằng{' '}
          <select value={matcher} onChange={(e) => setMatcher(e.target.value as Matcher)}>
            <option value='tokens'>tập từ tách sẵn</option>
            <option value='regex'>RegExp tạo mới mỗi URL (kiểu Similarweb)</option>
          </select>
        </label>
        <span className='ifl-spinner' aria-hidden='true' title='Quay đều nghĩa là luồng chính không bị chặn' />
      </div>

      <div className='toolbar'>
        {QUICK.map((rule) => (
          <button key={JSON.stringify(rule)} onClick={() => addRule(rule)} disabled={!ready}>
            + {rule.mode === 'include' ? 'có' : 'không có'} {rule.words.join(' / ')}
          </button>
        ))}
      </div>

      <form
        className='toolbar'
        onSubmit={(e) => {
          e.preventDefault();
          addDraft();
        }}
      >
        <select value={draft.mode} onChange={(e) => setDraft((d) => ({ ...d, mode: e.target.value as Rule['mode'] }))}>
          <option value='include'>có một trong các từ</option>
          <option value='exclude'>không có từ nào</option>
        </select>
        <input value={draft.words} placeholder='vd: cache, worker' onChange={(e) => setDraft((d) => ({ ...d, words: e.target.value }))} />
        <button type='submit' disabled={!ready}>
          Thêm điều kiện
        </button>
      </form>

      {rules.length === 0 ? (
        <p className='hint'>Chưa có điều kiện: hiện tất cả.</p>
      ) : (
        <ol className='ifl-rules'>
          {rules.map((rule, i) => (
            <li key={i}>
              {rule.mode === 'include' ? 'có' : 'không có'} <b>{rule.words.join(' / ')}</b>{' '}
              <button aria-label='Bỏ điều kiện' onClick={() => setRules((list) => list.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ol>
      )}

      <div className='stats'>
        <Stat label='kết quả' value={stats ? stats.count.toLocaleString('vi-VN') : ready ? '…' : 'đang nạp'} />
        <Stat label='URL phải quét' value={stats ? stats.scanned.toLocaleString('vi-VN') : '—'} />
        <Stat label='thời gian lọc' value={stats ? `${stats.ms.toFixed(1)}ms` : '—'} />
        <Stat label='frame dài nhất lúc lọc' value={stats ? <span className={stats.frame > 50 ? 'err' : 'ok'}>{stats.frame.toFixed(0)}ms</span> : '—'} />
        <Stat label='cách lọc' value={stats ? (stats.reused ? <span className='ok'>lọc tiếp kết quả cũ</span> : 'quét từ đầu') : '—'} />
      </div>

      <ul className='ifl-urls'>
        {stats?.top.map((url) => (
          <li key={url}>{url}</li>
        ))}
      </ul>
    </div>
  );
}

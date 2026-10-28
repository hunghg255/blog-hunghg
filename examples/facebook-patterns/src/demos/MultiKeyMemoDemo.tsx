import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { MultiKeyMap } from '../lib/multiKeyMap';
import { LoadState, createBatchLoader } from '../lib/loadState';
import { Log, Stat, sleep, useLog } from './shared';
import './MultiKeyMemoDemo.css';

/**
 * Mô phỏng hành vi MultiKeyMap gốc của Facebook (không phải mã gốc): delete chỉ gỡ lá,
 * các nút trung gian rỗng vẫn nằm lại trong Map mạnh.
 */
class FbStyleMultiKeyMap<V> {
  root = new Map<unknown, unknown>();
  set(keys: unknown[], value: V) {
    let node = this.root;
    for (let i = 0; i < keys.length - 1; i++) {
      let next = node.get(keys[i]) as Map<unknown, unknown> | undefined;
      if (!next) node.set(keys[i], (next = new Map()));
      node = next;
    }
    node.set(keys[keys.length - 1], { value });
  }
  delete(keys: unknown[]) {
    let node: Map<unknown, unknown> | undefined = this.root;
    for (let i = 0; i < keys.length - 1 && node; i++) node = node.get(keys[i]) as Map<unknown, unknown>;
    return node ? node.delete(keys[keys.length - 1]) : false;
  }
  countStrongNodes() {
    const walk = (n: Map<unknown, unknown>): number => {
      let c = 1;
      n.forEach((v) => {
        if (v instanceof Map) c += walk(v);
      });
      return c;
    };
    return walk(this.root);
  }
}

function TrieSection() {
  const [counts, setCounts] = useState({ fb: 1, fixed: 1, entries: 0 });
  const fbRef = useRef(new FbStyleMultiKeyMap<number>());
  const fixedRef = useRef(new MultiKeyMap<[string, number, string], number>());
  const keys = useMemo(() => {
    const out: [string, number, string][] = [];
    for (let u = 0; u < 400; u++) for (let p = 0; p < 5; p++) out.push([`user:${u}`, p, 'vi_VN']);
    return out;
  }, []);
  const refresh = (entries: number) =>
    setCounts({ fb: fbRef.current.countStrongNodes(), fixed: fixedRef.current.countStrongNodes(), entries });

  return (
    <section className='card mk-section'>
      <h2>1. Trie nhiều khoá: xoá xong có dọn không?</h2>
      <p className='hint'>
        Khoá <code>(userId, page, locale)</code>. Thêm 2.000 entry rồi xoá hết, đếm số nút trie còn bị giữ bằng tham
        chiếu mạnh.
      </p>
      <div className='toolbar'>
        <button
          className='primary'
          data-testid='mk-add'
          onClick={() => {
            keys.forEach((k, i) => {
              fbRef.current.set(k, i);
              fixedRef.current.set(k, i);
            });
            refresh(keys.length);
          }}
        >
          Thêm 2.000 entry
        </button>
        <button
          data-testid='mk-delete'
          onClick={() => {
            keys.forEach((k) => {
              fbRef.current.delete(k);
              fixedRef.current.delete(k);
            });
            refresh(0);
          }}
        >
          Xoá cả 2.000
        </button>
      </div>
      <div className='stats'>
        <Stat label='entry đang có' value={<output data-testid='mk-entries'>{counts.entries}</output>} />
        <Stat label='nút trie, kiểu Facebook' value={<output data-testid='mk-fb'>{counts.fb}</output>} />
        <Stat label='nút trie, bản có tỉa' value={<output data-testid='mk-fixed'>{counts.fixed}</output>} />
      </div>
    </section>
  );
}

type Cell = LoadState<string>;
let renderCount = 0;
const LoadCell = memo(function LoadCell({ state }: { state: Cell }) {
  renderCount++;
  return <span className={`mk-cell ${state.operation === 'loading' ? 'loading' : state.hasValue ? 'ok' : ''}`} />;
});

const N_CELLS = 300;

function InternSection() {
  const [interned, setInterned] = useState(true);
  const [cells, setCells] = useState<Cell[]>(() => Array.from({ length: N_CELLS }, () => LoadState.empty<string>()));
  const [stats, setStats] = useState({ unique: 1, renders: 0 });
  const before = useRef(0);

  const naiveLoading = (): Cell => ({ operation: 'loading', value: undefined, hasValue: false, error: undefined });

  useEffect(() => {
    setStats({ unique: new Set(cells).size, renders: renderCount - before.current });
  }, [cells]);

  const setAllLoading = () => {
    before.current = renderCount;
    setCells((prev) => prev.map(() => (interned ? LoadState.loading<string>() : naiveLoading())));
  };

  return (
    <section className='card mk-section'>
      <h2>2. Interning trạng thái "đang tải"</h2>
      <p className='hint'>
        300 ô bọc <code>React.memo</code>. Bấm "Đặt tất cả về loading" hai lần. Có interning thì lần hai là cùng object
        cũ, memo bỏ qua render.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={interned} onChange={(e) => setInterned(e.target.checked)} /> Interning
        </label>
        <button className='primary' data-testid='mk-loading' onClick={setAllLoading}>
          Đặt tất cả về loading
        </button>
        <button
          onClick={() => {
            before.current = renderCount;
            setCells((prev) => prev.map((_, i) => LoadState.withValue(`#${i}`)));
          }}
        >
          Tải xong
        </button>
      </div>
      <div className='stats'>
        <Stat label='object khác nhau' value={<output data-testid='mk-unique'>{stats.unique}</output>} />
        <Stat label='ô phải render lại' value={<output data-testid='mk-renders'>{stats.renders}</output>} />
        <Stat label='object trong pool' value={<output>{LoadState.poolSize()}</output>} />
      </div>
      <div className='mk-grid'>
        {cells.map((state, i) => (
          <LoadCell key={i} state={state} />
        ))}
      </div>
    </section>
  );
}

const AVATAR_IDS = Array.from({ length: 30 }, (_, i) => (i * 7) % 13); // 30 ô, 13 id khác nhau

function BatchSection() {
  const { lines, add, clear } = useLog(20);
  const [batching, setBatching] = useState(true);
  const [run, setRun] = useState(0);
  const [requests, setRequests] = useState(0);
  const [names, setNames] = useState<Record<number, string>>({});

  useEffect(() => {
    if (run === 0) return;
    let calls = 0;
    const fetchUsers = async (ids: number[]) => {
      calls++;
      add(`GET /users?ids=${ids.join(',')}`, 'muted');
      await sleep(150);
      return new Map(ids.map((id) => [id, `Người dùng ${id}`] as const));
    };
    const loader = createBatchLoader<number, string>({ loadMany: fetchUsers, maxBatchSize: 10 });
    const load = batching ? loader.load : (id: number) => fetchUsers([id]).then((m) => m.get(id) as string);
    // 30 component "mount" trong cùng một tick, mỗi cái tự gọi load(id)
    Promise.all(AVATAR_IDS.map((id) => load(id).then((name) => [id, name] as const))).then((pairs) => {
      setNames(Object.fromEntries(pairs));
      setRequests(calls);
      add(`${batching ? 'Có gom' : 'Không gom'}: ${calls} request cho 30 ô (13 id khác nhau)`, batching ? 'ok' : 'warn');
    });
  }, [run]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className='card mk-section'>
      <h2>3. Gom request kiểu LoadObjectMap</h2>
      <p className='hint'>30 avatar mount cùng lúc, mỗi cái tự xin dữ liệu người dùng. Lô tối đa 10 id.</p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={batching} onChange={(e) => setBatching(e.target.checked)} /> Gom request
        </label>
        <button
          className='primary'
          data-testid='mk-batch'
          onClick={() => {
            clear();
            setNames({});
            setRun((n) => n + 1);
          }}
        >
          Mount 30 avatar
        </button>
      </div>
      <div className='stats'>
        <Stat label='request' value={<output data-testid='mk-requests'>{requests}</output>} />
        <Stat label='đã có tên' value={<output>{Object.keys(names).length}/13</output>} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function MultiKeyMemoDemo() {
  return (
    <div className='page mk-demo'>
      <h1>Memo nhiều khoá, interning, gom request</h1>
      <TrieSection />
      <InternSection />
      <BatchSection />
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { BatchItemError, createApiBatcher, type BatchItemResponse, type BatchRequest } from '../lib/apiBatcher';
import { Log, Stat, sleep, useLog } from './shared';
import './ApiBatcherDemo.css';

type Mode = 'none' | 'batch';

/** chi phí cố định của mỗi request HTTP (TLS, header, hàng đợi server…) và của mỗi lời gọi */
const HTTP_OVERHEAD_MS = 180;
const PER_CALL_MS = 6;
const MAX_PARALLEL = 6; // trình duyệt giới hạn ~6 kết nối HTTP/1.1 mỗi host

const NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khoa', 'Lan', 'Minh', 'Ngọc', 'Phúc', 'Quân'];

function userBody(id: number) {
  return JSON.stringify({ id, name: NAMES[(id - 1) % NAMES.length] + ` #${id}` });
}

/** Server giả: tự hàng đợi theo số kết nối song song để mô phỏng chi phí mỗi request. */
function createFakeServer(failId: () => number | null, onHttp: (label: string) => void) {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = async () => {
    if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
    active++;
  };
  const release = () => {
    active--;
    waiting.shift()?.();
  };
  const handle = (req: BatchRequest): BatchItemResponse => {
    const id = Number(req.relativeUrl.match(/\/user\/(\d+)/)?.[1]);
    if (id === failId()) return { code: 404, body: JSON.stringify({ error: { message: 'User not found' } }) };
    return { code: 200, body: userBody(id) };
  };
  return {
    async single(req: BatchRequest) {
      await acquire();
      onHttp(`GET ${req.relativeUrl}`);
      await sleep(HTTP_OVERHEAD_MS + PER_CALL_MS);
      release();
      const res = handle(req)!;
      if (res.code >= 400) throw new BatchItemError(res.code, res.body);
      return JSON.parse(res.body);
    },
    async batch(reqs: BatchRequest[]) {
      await acquire();
      onHttp(`POST / batch=[${reqs.length} lời gọi]`);
      await sleep(HTTP_OVERHEAD_MS + PER_CALL_MS * reqs.length);
      release();
      return reqs.map(handle);
    },
  };
}

export default function ApiBatcherDemo() {
  const { lines, add, clear } = useLog(40);
  const [mode, setMode] = useState<Mode>('batch');
  const [count, setCount] = useState(12);
  const [failSeven, setFailSeven] = useState(false);
  const [dedupe, setDedupe] = useState(false);
  const [run, setRun] = useState(0);
  const [http, setHttp] = useState(0);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const failRef = useRef<number | null>(null);
  failRef.current = failSeven ? 7 : null;

  const server = useMemo(
    () =>
      createFakeServer(
        () => failRef.current,
        (label) => {
          setHttp((n) => n + 1);
          add(`HTTP ${label}`, 'muted');
        },
      ),
    [add],
  );
  const batcher = useMemo(
    () => createApiBatcher({ executeSingle: server.single, executeBatch: server.batch, dedupeGets: dedupe }),
    [server, dedupe],
  );

  const fetchUser = useMemo(() => {
    const req = (id: number): BatchRequest => ({ method: 'GET', relativeUrl: `/user/${id}?fields=name` });
    return mode === 'batch' ? (id: number) => batcher.call<{ name: string }>(req(id)) : (id: number) => server.single(req(id));
  }, [mode, batcher, server]);

  // 1/4 số thẻ trùng người (vd. cùng một người comment nhiều lần) để thấy tác dụng của dedupe
  const ids = useMemo(() => Array.from({ length: count }, (_, i) => (i % 4 === 3 ? i : i + 1)), [count]);

  const startRef = useRef(0);
  const doneRef = useRef(0);
  const onDone = () => {
    doneRef.current++;
    if (doneRef.current === ids.length) setElapsed(performance.now() - startRef.current);
  };

  const reload = () => setRun((n) => n + 1);

  // Lưới thẻ remount mỗi khi đổi cài đặt (key bên dưới). Effect của cha chạy SAU effect của
  // các thẻ con trong cùng lần commit, nhưng trước khi request giả kịp báo về, nên reset ở đây.
  useEffect(() => {
    clear();
    setHttp(0);
    setElapsed(null);
    doneRef.current = 0;
    startRef.current = performance.now();
  }, [run, mode, count, failSeven, dedupe, clear]);

  return (
    <div className='page ab-demo'>
      <h1>Gộp lời gọi API trong cùng một tick</h1>
      <p className='hint'>
        Mỗi thẻ tự gọi <code>/user/:id</code> khi mount. Không gộp thì {count} thẻ là {count} request
        HTTP, trình duyệt chỉ chạy song song khoảng 6 cái. Gộp thì mọi lời gọi phát ra trong cùng
        một tick đi chung một request; đủ 50 lời gọi thì tách chuyến.
      </p>
      <div className='toolbar'>
        <label>
          Cách gọi{' '}
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} data-testid='ab-mode'>
            <option value='batch'>gộp (ApiBatcher)</option>
            <option value='none'>mỗi lời gọi một request</option>
          </select>
        </label>
        <label>
          Số thẻ{' '}
          <select value={count} onChange={(e) => setCount(Number(e.target.value))} data-testid='ab-count'>
            {[1, 12, 60].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label className='switch'>
          <input type='checkbox' checked={failSeven} onChange={(e) => setFailSeven(e.target.checked)} />
          /user/7 trả 404
        </label>
        <label className='switch'>
          <input type='checkbox' checked={dedupe} onChange={(e) => setDedupe(e.target.checked)} />
          Gộp GET trùng URL
        </label>
        <button className='primary' onClick={reload} data-testid='ab-reload'>
          Tải lại
        </button>
      </div>
      <div className='stats'>
        <Stat label='request HTTP' value={<output data-testid='ab-http'>{http}</output>} />
        <Stat label='thời gian tới thẻ cuối' value={<output data-testid='ab-time'>{elapsed == null ? '…' : `${Math.round(elapsed)}ms`}</output>} />
      </div>
      <div className='ab-grid' key={`${run}-${mode}-${count}-${failSeven}-${dedupe}`}>
        {ids.map((id, i) => (
          <UserCard key={i} id={id} fetchUser={fetchUser} onDone={onDone} />
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

function UserCard({
  id,
  fetchUser,
  onDone,
}: {
  id: number;
  fetchUser: (id: number) => Promise<{ name: string }>;
  onDone: () => void;
}) {
  const [state, setState] = useState<{ name?: string; error?: string }>({});
  useEffect(() => {
    let alive = true;
    fetchUser(id).then(
      (user) => alive && setState({ name: user.name }),
      (error) => alive && setState({ error: error instanceof BatchItemError ? `lỗi ${error.code}` : 'lỗi mạng' }),
    );
    return () => {
      alive = false;
    };
  }, [id, fetchUser]);
  useEffect(() => {
    if (state.name || state.error) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <div className={`ab-card ${state.error ? 'ab-error' : ''}`}>
      <span className='ab-avatar'>{id}</span>
      {state.name ? <b>{state.name}</b> : state.error ? <span>{state.error}</span> : <span className='skeleton ab-line' />}
    </div>
  );
}

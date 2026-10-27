import { useState } from 'react';
import { createEndpoint, type DispatchMode } from '../lib/requestDispatcher';
import { sleep } from './shared';
import './RequestDispatcherDemo.css';

interface Payload {
  folder: 'inbox' | 'archive';
  ids: string[];
}

const MODES: { mode: DispatchMode; note: string }[] = [
  { mode: 'immediate', note: 'gửi ngay mọi lệnh' },
  { mode: 'idempotent', note: 'đang bay thì bỏ' },
  { mode: 'successive', note: 'đang bay thì gộp, gửi sau' },
  { mode: 'successiveUnique', note: 'như trên, bỏ dữ liệu trùng request đang bay' },
  { mode: 'conditional', note: 'chỉ gộp khi cùng folder' },
  { mode: 'deferredMulti', note: 'gộp hết, gửi cuối tick' },
  { mode: 'piggyback', note: 'lỗi thì đi nhờ chuyến sau' },
];

/** lệnh mẫu: chuyển thread vào folder (giống MOVE_THREAD / CHANGE_ARCHIVED_STATUS) */
const ACTIONS: Payload[] = [
  { folder: 'archive', ids: ['t1'] },
  { folder: 'archive', ids: ['t2'] },
  { folder: 'archive', ids: ['t3'] },
  { folder: 'inbox', ids: ['t4'] },
  { folder: 'archive', ids: ['t5'] },
  { folder: 'archive', ids: ['t5'] },
];

const LATENCY = 300;

const combine = (a: Payload, b: Payload): Payload => ({ folder: b.folder, ids: [...new Set([...a.ids, ...b.ids])] });
const label = (p: Payload) => `${p.folder}:${p.ids.join('+')}`;

interface Result {
  requests: string[];
  skipped: number;
}

async function runMode(mode: DispatchMode, spacing: 'tick' | 'spread', failFirst: boolean): Promise<Result> {
  const requests: string[] = [];
  let skipped = 0;
  let calls = 0;
  const endpoint = createEndpoint<Payload>({
    mode,
    combine,
    combineIf: (current, next) => current.folder === next.folder,
    send: async (data) => {
      const n = ++calls;
      requests.push(label(data) + (failFirst && n === 1 ? ' ✗' : ''));
      await sleep(LATENCY);
      if (failFirst && n === 1) throw new Error('500');
    },
    onEvent: (e) => {
      if (e.type === 'skipped') skipped++;
    },
  });
  for (const action of ACTIONS) {
    endpoint.trySend(action);
    if (spacing === 'spread') await sleep(70);
  }
  // piggyback: dữ liệu lỗi chỉ đi khi có lệnh kế tiếp, nên gửi thêm một lệnh cuối
  if (mode === 'piggyback' && failFirst) {
    await sleep(LATENCY + 50);
    endpoint.trySend({ folder: 'archive', ids: ['t6'] });
  }
  await sleep(LATENCY * 4);
  return { requests, skipped };
}

export default function RequestDispatcherDemo() {
  const [spacing, setSpacing] = useState<'tick' | 'spread'>('spread');
  const [failFirst, setFailFirst] = useState(false);
  const [results, setResults] = useState<Partial<Record<DispatchMode, Result>>>({});
  const [running, setRunning] = useState(false);
  const [bug, setBug] = useState<{ legacy: string[]; fixed: string[] } | null>(null);

  async function runAll() {
    setRunning(true);
    setResults({});
    const entries = await Promise.all(MODES.map(async ({ mode }) => [mode, await runMode(mode, spacing, failFirst)] as const));
    setResults(Object.fromEntries(entries));
    setRunning(false);
  }

  async function runBug() {
    setRunning(true);
    const sequence = async (legacy: boolean) => {
      const sent: string[] = [];
      const ep = createEndpoint<{ q: string }>({
        mode: 'successiveUnique',
        legacyClearPendingAfterFlush: legacy,
        send: async (d) => {
          sent.push(d.q);
          await sleep(200);
        },
      });
      ep.trySend({ q: 'trang 1' }); // gửi ngay
      ep.trySend({ q: 'trang 2' }); // đang bay → gói chờ
      await sleep(250); // trang 1 xong → gửi gói chờ "trang 2"
      ep.trySend({ q: 'trang 2' }); // trùng request đang bay → phải bị bỏ
      await sleep(600);
      return sent;
    };
    const [legacy, fixed] = await Promise.all([sequence(true), sequence(false)]);
    setBug({ legacy, fixed });
    setRunning(false);
  }

  return (
    <div className='page dispatcher-demo'>
      <h1>Bộ điều phối request bảy chế độ</h1>
      <p className='hint'>
        Sáu lệnh &quot;chuyển thread sang folder&quot; bắn liên tiếp vào cùng một endpoint, server mất {LATENCY}ms mỗi request.
        Mỗi chế độ quyết định khác nhau: gửi ngay, bỏ, gộp, hay hoãn.
      </p>

      <div className='toolbar' role='group' aria-label='Nhịp bắn lệnh'>
        <button className={spacing === 'spread' ? 'primary' : ''} aria-pressed={spacing === 'spread'} onClick={() => setSpacing('spread')} disabled={running}>
          Cách nhau 70ms
        </button>
        <button className={spacing === 'tick' ? 'primary' : ''} aria-pressed={spacing === 'tick'} onClick={() => setSpacing('tick')} disabled={running}>
          Cùng một tick
        </button>
        <label>
          <input type='checkbox' checked={failFirst} onChange={(e) => setFailFirst(e.target.checked)} disabled={running} /> request
          đầu lỗi 500
        </label>
        <button className='primary' onClick={runAll} disabled={running}>
          {running ? 'Đang chạy…' : 'Chạy cả 7 chế độ'}
        </button>
      </div>

      <div className='table-wrap'>
        <table data-testid='modes'>
          <thead>
            <tr>
              <th>chế độ</th>
              <th>request</th>
              <th>payload thực gửi</th>
            </tr>
          </thead>
          <tbody>
            {MODES.map(({ mode, note }) => {
              const r = results[mode];
              return (
                <tr key={mode} data-mode={mode}>
                  <td>
                    <code>{mode}</code>
                    <div className='muted'>{note}</div>
                  </td>
                  <td className='count'>{r ? r.requests.length : '–'}</td>
                  <td>
                    {r?.requests.map((p, i) => (
                      <span key={i} className={`chip${p.endsWith('✗') ? ' fail' : ''}`}>
                        {p}
                      </span>
                    ))}
                    {r && r.skipped > 0 && <span className='muted'> (bỏ {r.skipped})</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className='card'>
        <h2>Lỗi của bản gốc: xoá nhầm dữ liệu request đang bay</h2>
        <p className='muted'>
          Chế độ <code>successiveUnique</code>: gửi trang 1, xếp trang 2, trang 1 xong thì gửi trang 2, rồi lại yêu cầu trang 2
          lần nữa trong lúc nó đang bay.
        </p>
        <div className='toolbar'>
          <button onClick={runBug} disabled={running}>
            Chạy
          </button>
        </div>
        {bug && (
          <ul className='bug-list' data-testid='bug'>
            <li>
              Kiểu Facebook (xoá pending sau khi gửi gói chờ): <b>{bug.legacy.length} request</b> — {bug.legacy.join(', ')}
            </li>
            <li>
              Bản viết lại: <b>{bug.fixed.length} request</b> — {bug.fixed.join(', ')}
            </li>
          </ul>
        )}
      </section>
    </div>
  );
}

import { useRef, useState } from 'react';
import { createSyncHandler, type SyncEvent } from '../lib/syncSeqId';
import { createFbStyleSync } from './syncSeqIdFbStyle';
import { Log, Stat, sleep, useLog } from './shared';
import './SyncSeqIdDemo.css';

type Cell = 'applied' | 'waiting' | 'missing' | 'dropped';

interface Counters {
  applied: number;
  holes: number;
  global: number;
  narrow: number;
}

const ZERO: Counters = { applied: 0, holes: 0, global: 0, narrow: 0 };
const SERVER_SEQ_AFTER_GLOBAL = 12;

export default function SyncSeqIdDemo() {
  const { lines, add, clear } = useLog(60);
  const [grace, setGrace] = useState(150);
  const [cells, setCells] = useState<Record<number, Cell>>({});
  const [counters, setCounters] = useState<Counters>(ZERO);
  const [failMessage, setFailMessage] = useState(true);
  const [failThread, setFailThread] = useState(true);
  const [running, setRunning] = useState(false);
  const runId = useRef(0);

  const bump = (key: keyof Counters) => setCounters((c) => ({ ...c, [key]: c[key] + 1 }));
  const mark = (seq: number, cell: Cell) => setCells((c) => ({ ...c, [seq]: cell }));

  function newHandler(graceMs: number) {
    const handler = createSyncHandler<string>({
      holeGraceMs: graceMs,
      apply: (seq) => {
        mark(seq, 'applied');
        bump('applied');
      },
      fetchMessage: async () => {
        await sleep(250);
        if (failMessage) throw new Error('message DFF lỗi');
      },
      fetchThread: async () => {
        await sleep(350);
        if (failThread) throw new Error('thread DFF lỗi');
      },
      fetchGlobal: async () => {
        await sleep(600);
        return { seqId: SERVER_SEQ_AFTER_GLOBAL };
      },
      onEvent: (e: SyncEvent) => {
        if (e.type === 'hole') {
          bump('holes');
          add(`lỗ: last=${e.last}, next=${e.next}${graceMs ? ` → chờ ${graceMs}ms` : ' → fetch ngay'}`, 'warn');
        } else if (e.type === 'hole-filled') add(`delta #${e.seqId} tới trễ, lấp được lỗ`, 'ok');
        else if (e.type === 'drop') mark(e.seqId, 'dropped');
        else if (e.type === 'fetch-start') {
          bump(e.level === 'global' ? 'global' : 'narrow');
          add(`fetch ${e.level}${e.seqId ? ` (#${e.seqId})` : ''}…`, e.level === 'global' ? 'warn' : undefined);
        } else if (e.type === 'fetch-ok') add(`fetch ${e.level} xong`, 'ok');
        else if (e.type === 'fetch-fail') add(`fetch ${e.level} lỗi → rơi xuống tầng rộng hơn`, 'err');
      },
    });
    handler.init(0);
    return handler;
  }

  async function run(name: string, script: (h: ReturnType<typeof newHandler>, my: number) => Promise<void>) {
    const my = ++runId.current;
    clear();
    setCells({});
    setCounters(ZERO);
    setRunning(true);
    add(`▶ ${name} (chờ lỗ ${grace}ms)`);
    const h = newHandler(grace);
    await script(h, my);
    await sleep(1400);
    if (runId.current === my) {
      add(`lastSeqID = ${h.lastSeqId}`, 'ok');
      setRunning(false);
    }
    h.dispose();
  }

  /** gửi delta 1..n, `order` cho phép đổi thứ tự, `lost` là seq bị mất */
  async function stream(h: ReturnType<typeof newHandler>, order: number[], lost: number[] = []) {
    for (const seq of order) {
      if (lost.includes(seq)) {
        mark(seq, 'missing');
        continue;
      }
      mark(seq, 'waiting');
      h.receive(seq, { kind: 'data', payload: `delta ${seq}` });
      await sleep(40);
    }
  }

  const reorder = () =>
    run('Delta tới sai thứ tự (#4 tới trước #3)', async (h) => {
      await stream(h, [1, 2, 4, 5, 3, 6, 7, 8]);
    });

  const lost = () =>
    run('Mất delta #4', async (h) => {
      await stream(h, [1, 2, 3, 4, 5, 6, 7, 8], [4]);
    });

  const forced = () =>
    run('Server ép tải lại một tin (DFF)', async (h) => {
      await stream(h, [1, 2]);
      add('server gửi #3: forced fetch tin m42 trong thread t7');
      mark(3, 'waiting');
      h.receive(3, { kind: 'forcedFetch', threadKey: 't7', messageId: 'm42' });
      await sleep(40);
      await stream(h, [4, 5]);
    });

  async function compareRace() {
    const my = ++runId.current;
    clear();
    setCells({});
    setCounters(ZERO);
    setRunning(true);
    add('▶ Lệnh "đồng bộ toàn bộ" tới lúc đang pause, còn delta #2, #3 chờ (thiếu #1)');

    add('— Kiểu Facebook —');
    const fb = createFbStyleSync({
      apply: () => {},
      fetchGlobal: async () => {
        await sleep(400);
        return SERVER_SEQ_AFTER_GLOBAL;
      },
      onEvent: (text, tone) => add(`[FB] ${text}`, tone),
    });
    fb.init(0);
    fb.pause();
    fb.receive(2);
    fb.receive(3);
    fb.receiveFakeGlobalDff();
    try {
      fb.resume();
    } catch {
      add('[FB] ném lỗi trong callback realtime: delta còn lại không được xử lý', 'err');
    }
    await sleep(600);

    add('— Bản viết lại —');
    const fixed = createSyncHandler<string>({
      apply: (seq) => add(`[mới] áp dụng #${seq}`),
      fetchMessage: async () => {},
      fetchThread: async () => {},
      fetchGlobal: async () => {
        await sleep(400);
        return { seqId: SERVER_SEQ_AFTER_GLOBAL };
      },
      onEvent: (e) => {
        if (e.type === 'fetch-start') add('[mới] global fetch…', 'warn');
        if (e.type === 'fetch-ok') add(`[mới] global xong, delta #2, #3 cũ hơn snapshot nên bị bỏ`, 'ok');
      },
    });
    fixed.init(0);
    fixed.pause();
    fixed.receive(2, { kind: 'data', payload: 'b' });
    fixed.receive(3, { kind: 'data', payload: 'c' });
    fixed.forceGlobalSync();
    fixed.resume();
    await sleep(700);
    add(`[mới] lastSeqID = ${fixed.lastSeqId}, không có fetch thứ hai`, 'ok');
    fixed.dispose();
    if (runId.current === my) setRunning(false);
  }

  const seqs = Object.keys(cells)
    .map(Number)
    .sort((a, b) => a - b);

  return (
    <div className='page sync-seq'>
      <h1>Đồng bộ delta theo seqID</h1>
      <p className='hint'>
        Mỗi delta realtime có số thứ tự tăng dần. Client chỉ áp dụng khi <code>next − last = 1</code>; thấy khoảng trống thì
        đồng bộ bù. Facebook tải lại toàn bộ ngay khi thấy lỗ; bản viết lại chờ một chút vì delta tới trễ vài chục ms là
        chuyện thường.
      </p>

      <div className='toolbar' role='group' aria-label='Thời gian chờ lỗ'>
        <span className='muted'>Chờ lỗ:</span>
        {[0, 150].map((ms) => (
          <button key={ms} className={grace === ms ? 'primary' : ''} aria-pressed={grace === ms} onClick={() => setGrace(ms)} disabled={running}>
            {ms === 0 ? '0ms (như Facebook)' : `${ms}ms`}
          </button>
        ))}
      </div>

      <div className='toolbar'>
        <button onClick={reorder} disabled={running}>
          Sai thứ tự
        </button>
        <button onClick={lost} disabled={running}>
          Mất gói
        </button>
        <button onClick={forced} disabled={running}>
          Server ép fetch (DFF)
        </button>
        <label>
          <input type='checkbox' checked={failMessage} onChange={(e) => setFailMessage(e.target.checked)} /> fetch 1 tin lỗi
        </label>
        <label>
          <input type='checkbox' checked={failThread} onChange={(e) => setFailThread(e.target.checked)} /> fetch thread lỗi
        </label>
      </div>
      <div className='toolbar'>
        <button onClick={compareRace} disabled={running}>
          So sánh: lệnh đồng bộ toàn bộ khi đang pause
        </button>
      </div>

      <div className='seq-strip' aria-label='Trạng thái từng seqID'>
        {seqs.length === 0 && <span className='muted'>Chọn một kịch bản ở trên.</span>}
        {seqs.map((seq) => (
          <span key={seq} className={`seq-cell ${cells[seq]}`} title={cells[seq]}>
            {seq}
          </span>
        ))}
      </div>
      <p className='legend muted'>
        <span className='seq-cell applied'>✓</span> đã áp dụng <span className='seq-cell waiting'>…</span> đang chờ{' '}
        <span className='seq-cell missing'>?</span> mất <span className='seq-cell dropped'>×</span> bỏ (cũ hơn snapshot)
      </p>

      <div className='stats'>
        <Stat label='delta áp dụng' value={<bdi data-testid='applied'>{counters.applied}</bdi>} />
        <Stat label='lần thấy lỗ' value={<bdi data-testid='holes'>{counters.holes}</bdi>} />
        <Stat label='tải lại toàn bộ' value={<bdi data-testid='global'>{counters.global}</bdi>} />
        <Stat label='fetch tin/thread' value={<bdi data-testid='narrow'>{counters.narrow}</bdi>} />
      </div>

      <Log lines={lines} />
    </div>
  );
}

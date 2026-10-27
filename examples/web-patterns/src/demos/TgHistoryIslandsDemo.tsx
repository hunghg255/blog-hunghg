import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createMessageHistory,
  findClosestIndex,
  type FetchSlice,
  type HistoryState,
  type Island,
  type MessageHistory,
} from '../lib/tgHistoryIslands';
import { Log, Stat, sleep, useLog } from './shared';
import './TgHistoryIslandsDemo.css';

const SLICE = 30;

/** Lịch sử giả: id 1..3000, khoảng 25% bị xoá (id không liền nhau như thật). */
function buildServerIds() {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ids: number[] = [];
  for (let id = 1; id <= 3000; id++) if (rand() > 0.25) ids.push(id);
  return ids;
}

function createFakeServer(ids: number[], latency: { current: number }): FetchSlice {
  return async ({ offsetId, direction, limit }) => {
    await sleep(latency.current);
    let from: number;
    if (offsetId === undefined) from = ids.length - limit;
    else {
      const index = findClosestIndex(ids, offsetId);
      if (direction === 'backwards') from = ids[index] < offsetId ? index + 1 - limit : index - limit;
      else if (direction === 'forwards') from = ids[index] > offsetId ? index : index + 1;
      else from = index - Math.floor(limit / 2);
    }
    const start = Math.max(0, from);
    const end = Math.min(ids.length, from + limit);
    return { ids: ids.slice(start, end), hasOldest: start === 0, hasNewest: end === ids.length };
  };
}

function Range({ island, max, className, label }: { island?: Pick<Island, 'ids'>; max: number; className: string; label: string }) {
  if (!island || island.ids.length === 0) return null;
  const first = island.ids[0];
  const last = island.ids[island.ids.length - 1];
  return (
    <div
      className={`tg-hist-range ${className}`}
      style={{ left: `${(first / max) * 100}%`, width: `max(3px, ${((last - first) / max) * 100}%)` }}
      title={`${label}: #${first}–#${last} (${island.ids.length} tin)`}
    />
  );
}

export default function TgHistoryIslandsDemo() {
  const { lines, add, clear } = useLog(40);
  const serverIds = useMemo(buildServerIds, []);
  // id lớn nhất lúc đầu; tin "realtime" tới sau có id lớn hơn
  const [maxId] = useState(() => serverIds[serverIds.length - 1]);
  const latency = useRef(500);
  const [latencyMs, setLatencyMs] = useState(500);
  latency.current = latencyMs;
  const [state, setState] = useState<HistoryState>({ viewport: [], viewportIsland: 'listed' });
  const [requests, setRequests] = useState(0);
  const [preloads, setPreloads] = useState(0);
  const [instant, setInstant] = useState(0);
  const [jumpId, setJumpId] = useState('1234');
  const [newCounter, setNewCounter] = useState(0);
  const historyRef = useRef<MessageHistory | null>(null);
  const extraIds = useRef(maxId);

  const restart = () => {
    const history = createMessageHistory({
      fetchSlice: createFakeServer(serverIds, latency),
      slice: SLICE,
      onChange: setState,
      onFetch: ({ direction, offsetId, isPreload }) => {
        setRequests((n) => n + 1);
        if (isPreload) setPreloads((n) => n + 1);
        add(`API ${direction}${offsetId !== undefined ? ` từ #${offsetId}` : ''}${isPreload ? ' (tải trước)' : ''}`, isPreload ? 'muted' : undefined);
      },
    });
    historyRef.current = history;
    setRequests(0);
    setPreloads(0);
    setInstant(0);
    setNewCounter(0);
    clear();
    void history.jumpTo();
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(restart, []);

  const timed = async (label: string, run: () => Promise<unknown>) => {
    const before = performance.now();
    await run();
    const ms = Math.round(performance.now() - before);
    if (ms < 20) setInstant((n) => n + 1);
    add(`${label}: ${ms < 20 ? 'hiện ngay từ bộ nhớ' : `${ms}ms (chờ mạng)`}`, ms < 20 ? 'ok' : undefined);
  };

  const jump = (id: number) => void timed(`nhảy tới #${id}`, () => historyRef.current!.jumpTo(id));

  const incoming = () => {
    const id = ++extraIds.current;
    serverIds.push(id);
    const placed = historyRef.current!.receiveNew(id);
    if (!placed) setNewCounter((n) => n + 1);
    add(placed ? `tin mới #${id} nối vào đảo chứa tin mới nhất` : `tin mới #${id}: chưa đảo nào chạm cuối, chỉ tăng bộ đếm`, 'muted');
  };

  const { listed, outlying, viewport, viewportIsland } = state;
  const max = Math.max(maxId, extraIds.current);

  return (
    <div className='page tg-hist'>
      <h1>Lịch sử tin nhắn chia đảo</h1>
      <p className='hint'>
        Lịch sử thật có {serverIds.length.toLocaleString('vi-VN')} tin (id có khoảng trống vì tin bị xoá). Mỗi lần chỉ tải
        một lát {SLICE} tin. Nhảy tới tin cũ tạo đảo phụ (màu vàng) tách khỏi đảo chính (màu xanh); cuộn tới khi chạm đảo chính thì hai đảo gộp lại. Sau mỗi
        lần cuộn, lát kế tiếp được tải trước nên lần cuộn sau hiện ngay.
      </p>

      <div className='tg-hist-map' aria-label='Bản đồ lịch sử đã tải'>
        <Range island={listed} max={max} className='listed' label='đảo chính' />
        <Range island={outlying} max={max} className='outlying' label='đảo phụ' />
        <Range island={{ ids: viewport }} max={max} className='viewport' label='viewport' />
      </div>
      <div className='tg-hist-legend'>
        <span className='listed'>đảo chính {listed ? `#${listed.ids[0]}–#${listed.ids[listed.ids.length - 1]}` : '—'}</span>
        <span className='outlying'>
          đảo phụ {outlying ? `#${outlying.ids[0]}–#${outlying.ids[outlying.ids.length - 1]}` : '—'}
        </span>
        <span className='viewport'>viewport trên {viewportIsland === 'listed' ? 'đảo chính' : 'đảo phụ'}</span>
      </div>

      <div className='stats'>
        <Stat label='request' value={requests} />
        <Stat label='trong đó tải trước' value={preloads} />
        <Stat label='lần hiện ngay' value={instant} />
        <Stat label='tin trong bộ nhớ' value={(listed?.ids.length ?? 0) + (outlying?.ids.length ?? 0)} />
      </div>

      <div className='toolbar'>
        <button type='button' onClick={() => void timed('cuộn lên', () => historyRef.current!.scroll('backwards'))}>
          ⬆ Cuộn lên
        </button>
        <button type='button' onClick={() => void timed('cuộn xuống', () => historyRef.current!.scroll('forwards'))}>
          ⬇ Cuộn xuống
        </button>
        <form
          className='tg-hist-jump'
          onSubmit={(e) => {
            e.preventDefault();
            const id = Number(jumpId);
            if (id > 0) jump(id);
          }}
        >
          <input type='text' inputMode='numeric' value={jumpId} onChange={(e) => setJumpId(e.target.value)} aria-label='id tin' />
          <button type='submit'>Nhảy tới tin</button>
        </form>
        <button type='button' onClick={() => void timed('về cuối', () => historyRef.current!.jumpTo())}>
          Về tin mới nhất
        </button>
        <button type='button' onClick={incoming}>
          Tin mới tới {newCounter > 0 && <span className='badge'>{newCounter}</span>}
        </button>
        <label>
          Độ trễ API: <b>{latencyMs}ms</b>
          <input type='range' min={100} max={1500} step={100} value={latencyMs} onChange={(e) => setLatencyMs(+e.target.value)} />
        </label>
        <button type='button' onClick={restart}>
          Làm lại
        </button>
      </div>

      <div className='tg-hist-viewport' aria-label='Tin đang hiện'>
        {viewport.map((id) => (
          <div key={id} className={id > maxId ? 'new' : ''}>
            <b>#{id}</b> {id % 7 === 0 ? 'Ảnh' : id % 5 === 0 ? 'Ok nhé' : 'Tin nhắn'} {id}
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

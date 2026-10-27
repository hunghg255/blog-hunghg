import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createWarmUp,
  defineBitFlags,
  isSynthetic,
  updateFlag,
  type WarmUpCandidate,
} from '../lib/syntheticPrefetch';
import { Log, Stat, sleep, useLog } from './shared';
import './SyntheticPrefetchDemo.css';

const DAY = 86_400_000;
const NOW = Date.now();

const GROUPS: (WarmUpCandidate & { name: string })[] = [
  { id: 'design', name: 'Thiết kế', favorite: true, lastVisited: NOW - 1 * DAY, rank: 0 },
  { id: 'sales', name: 'Bán hàng', favorite: false, lastVisited: NOW - 2 * DAY, rank: 1 },
  { id: 'hr', name: 'Nhân sự', favorite: false, lastVisited: NOW - 40 * DAY, rank: 2 },
  { id: 'dev', name: 'Kỹ thuật', favorite: true, lastVisited: NOW - 5 * DAY, rank: 3 },
  { id: 'ops', name: 'Vận hành', favorite: false, lastVisited: NOW - 12 * DAY, rank: 4 },
  { id: 'cafe', name: 'Hội cà phê', favorite: false, lastVisited: NOW - 3 * DAY, rank: 7 },
  { id: 'legal', name: 'Pháp chế', favorite: false, rank: 5 },
];

const COLD_MS = 900;
const WARM_MS = 120;
const DEMO_DELAY_MS = 2000; // Outlook dùng 10 giây; rút ngắn cho demo

type HeaderMode = 'synthetic' | 'plain';

/** Server giả: nhớ group nào đã nạp vào cache, và đếm "lượt người dùng mở group". */
function createFakeServer() {
  const cache = new Set<string>();
  const opens = new Map<string, number>();
  return {
    async fetchGroup(id: string, headers: Headers) {
      const hit = cache.has(id);
      await sleep(hit ? WARM_MS : COLD_MS);
      cache.add(id);
      if (!isSynthetic(headers)) opens.set(id, (opens.get(id) ?? 0) + 1);
      return { hit };
    },
    opens: () => [...opens.values()].reduce((a, b) => a + b, 0),
    reset() {
      cache.clear();
      opens.clear();
    },
  };
}

const FLAGS = defineBitFlags({
  dateHeadersDisabled: 1,
  folderPaneCollapsed: 2,
  hideSenderImage: 3,
  hideNews: 10,
  spotlightDisabled: 11,
});
const FLAG_LABELS: Record<keyof typeof FLAGS.positions, string> = {
  dateHeadersDisabled: 'Tắt tiêu đề theo ngày',
  folderPaneCollapsed: 'Thu gọn cột thư mục',
  hideSenderImage: 'Ẩn ảnh người gửi',
  hideNews: 'Ẩn tin tức',
  spotlightDisabled: 'Tắt Spotlight',
};

export default function SyntheticPrefetchDemo() {
  const { lines, add } = useLog(40);
  const server = useMemo(createFakeServer, []);
  const [headerMode, setHeaderMode] = useState<HeaderMode>('synthetic');
  const [phase, setPhase] = useState<'idle' | 'waiting' | 'done'>('idle');
  const [warmed, setWarmed] = useState<string[]>([]);
  const [opens, setOpens] = useState(0);
  const [realClicks, setRealClicks] = useState(0);
  const warmUpRef = useRef<ReturnType<typeof createWarmUp> | null>(null);

  useEffect(() => () => warmUpRef.current?.cancel(), []);

  function boot() {
    warmUpRef.current?.cancel();
    server.reset();
    setOpens(0);
    setRealClicks(0);
    setWarmed([]);
    setPhase('waiting');
    add(`Khởi động app. Warm-up sẽ chạy sau ${DEMO_DELAY_MS / 1000} giây.`, 'muted');
    const warmUp = createWarmUp({
      candidates: () => GROUPS,
      delayMs: DEMO_DELAY_MS,
      warm: async (id, headers) => {
        if (headerMode === 'plain') headers = new Headers(); // quên gắn header
        setWarmed((w) => [...w, id]);
        await server.fetchGroup(id, headers);
        setOpens(server.opens());
        setPhase('done');
      },
    });
    warmUp.trigger();
    warmUp.trigger(); // gọi thêm lần nữa: không warm hai lần
    warmUpRef.current = warmUp;
  }

  async function open(group: (typeof GROUPS)[number]) {
    const t0 = performance.now();
    const { hit } = await server.fetchGroup(group.id, new Headers());
    const ms = Math.round(performance.now() - t0);
    const measure = warmUpRef.current?.measure(group.id);
    setRealClicks((n) => n + 1);
    setOpens(server.opens());
    add(
      `Mở "${group.name}": ${ms}ms (${hit ? 'cache nóng' : 'cache lạnh'})` +
        (measure?.warmed ? `, TimeSinceWarmUp=${Math.round((measure.msSinceWarmUp ?? 0) / 1000)}s` : ''),
      hit ? 'ok' : 'warn',
    );
  }

  return (
    <div className='page sp'>
      <h1>Warm-up có đánh dấu synthetic + bit flags</h1>
      <p className='hint'>
        Bấm <b>Khởi động</b>, chờ warm-up chạy rồi mở vài group: group được warm mở trong khoảng {WARM_MS}ms, group khác
        mất {COLD_MS}ms. Đổi sang "Không gắn header" để thấy số liệu "lượt mở group" của server bị đếm sai.
      </p>

      <div className='toolbar'>
        <button className='primary' onClick={boot}>
          Khởi động
        </button>
        <button
          className={headerMode === 'synthetic' ? 'primary' : ''}
          aria-pressed={headerMode === 'synthetic'}
          onClick={() => setHeaderMode('synthetic')}
        >
          Gắn header synthetic
        </button>
        <button
          className={headerMode === 'plain' ? 'primary' : ''}
          aria-pressed={headerMode === 'plain'}
          onClick={() => setHeaderMode('plain')}
        >
          Không gắn header
        </button>
      </div>

      <div className='stats'>
        <Stat label='Trạng thái' value={phase === 'idle' ? '–' : phase === 'waiting' ? 'chờ…' : 'đã warm'} />
        <Stat label='Lượt mở thật' value={realClicks} />
        <Stat label='Server đếm "lượt mở"' value={opens > realClicks ? `${opens} ⚠ đếm sai` : opens} />
      </div>

      <ul className='sp-groups'>
        {GROUPS.map((g) => {
          const days = g.lastVisited === undefined ? null : Math.round((NOW - g.lastVisited) / DAY);
          return (
            <li key={g.id}>
              <button onClick={() => open(g)} disabled={phase === 'idle'}>
                {g.favorite ? '★ ' : ''}
                {g.name}
              </button>
              <span className='muted'>
                vị trí {g.rank + 1} · {days === null ? 'chưa mở' : `mở ${days} ngày trước`}
              </span>
              {warmed.includes(g.id) && <span className='badge ok'>warm</span>}
            </li>
          );
        })}
      </ul>

      <BitFlagsPanel onLog={add} />

      <Log lines={lines} />
    </div>
  );
}

function BitFlagsPanel({ onLog }: { onLog: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [value, setValue] = useState(0);
  const [stored, setStored] = useState(0);
  const [writes, setWrites] = useState(0);
  const [original, setOriginal] = useState(false);

  function toggle(name: keyof typeof FLAGS.positions) {
    const on = !FLAGS.has(value, name);
    if (original) {
      // Bản gốc: chỉ sửa khi số hiện tại "truthy", nên từ 0 thì không bật được gì
      const next = value ? FLAGS.set(value, name, on) : value;
      setValue(next);
      setStored(next);
      setWrites((n) => n + 1);
      onLog(
        `[bản gốc] ${FLAG_LABELS[name]} → ${on ? 'bật' : 'tắt'}; lưu ${next}${next === value && !value ? ' (không đổi gì!)' : ''}`,
        next === value ? 'err' : 'muted',
      );
      return;
    }
    const next = updateFlag(FLAGS, value, name, on, (n) => {
      setStored(n);
      setWrites((w) => w + 1);
    });
    setValue(next);
    onLog(`${FLAG_LABELS[name]} → ${on ? 'bật' : 'tắt'}; lưu ${next}`, 'muted');
  }

  return (
    <section className='card sp-flags'>
      <h2>Bit flags: {FLAGS.names.length} cờ trong một số nguyên</h2>
      <div className='toolbar'>
        {FLAGS.names.map((name) => (
          <label key={name}>
            <input type='checkbox' checked={FLAGS.has(value, name)} onChange={() => toggle(name)} /> {FLAG_LABELS[name]}{' '}
            <span className='muted'>(bit {FLAGS.positions[name]})</span>
          </label>
        ))}
      </div>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={original} onChange={(e) => setOriginal(e.target.checked)} /> Mô phỏng bản gốc
          (bỏ qua khi giá trị đang là 0)
        </label>
        <button
          onClick={() => {
            setValue(0);
            setStored(0);
            setWrites(0);
          }}
        >
          Về 0
        </button>
      </div>
      <code className='sp-bits'>
        {stored} = 0b{(stored >>> 0).toString(2).padStart(12, '0')} · {writes} lần ghi cấu hình
      </code>
    </section>
  );
}

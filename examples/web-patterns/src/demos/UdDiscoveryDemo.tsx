import { useMemo, useRef, useState } from 'react';
import { Log, useLog } from './shared';
import {
  createFeatureDiscovery,
  memoryStorage,
  type FeatureConfig,
  type FeatureDiscovery,
  type FeatureEvent,
} from '../lib/udDiscoverability';
import './UdDiscoveryDemo.css';

const FEATURES: (FeatureConfig & { name: string })[] = [
  { id: 'reminder', name: 'Nhắc lịch học', escalateAfterSessions: 3, dormantAfterSessions: 6, resumeAfterSessions: 2, daysToResurrect: 14 },
  { id: 'notes', name: 'Ghi chú trong video', escalateAfterSessions: 3, dormantAfterSessions: 6, resumeAfterSessions: 2, daysToResurrect: 14 },
];

type Mode = 'udemy' | 'ours';

interface World {
  now: number;
  session: number;
  features: FeatureDiscovery[];
}

/**
 * Mô phỏng hai cách:
 * - 'udemy': đếm phiên theo lần nhìn thấy gần nhất, và sự kiện bấm trên một tính năng được phát
 *   lên `document` với tên chung, nên MỌI tính năng đều nhận (giống bản gốc);
 * - 'ours': đếm theo lần đếm gần nhất, sự kiện chỉ đi tới đúng tính năng.
 */
function createWorld(mode: Mode, log: (t: string, tone?: 'ok' | 'warn' | 'err') => void): World {
  const world: World = { now: Date.UTC(2026, 9, 1, 8), session: 1, features: [] };
  const storage = memoryStorage();
  world.features = FEATURES.map((cfg) =>
    createFeatureDiscovery(cfg, {
      userId: 'u42',
      storage,
      sessionId: `s${world.session}`,
      now: () => world.now,
      boundary: mode === 'udemy' ? 'since-last-seen' : 'since-last-count',
      onTransition: (from, to, ev) => log(`${mode === 'udemy' ? 'Udemy' : 'Viết lại'} · ${cfg.name}: ${from} → ${to} (${ev})`, to === 'END' ? 'warn' : 'ok'),
    }),
  );
  return world;
}

export default function UdDiscoveryDemo() {
  const { lines, add } = useLog(40);
  const [, force] = useState(0);
  const rerender = () => force((n) => n + 1);
  const worlds = useRef<Record<Mode, World> | null>(null);
  worlds.current ??= { udemy: createWorld('udemy', add), ours: createWorld('ours', add) };
  const [days, setDays] = useState(0);

  const visitAfter = (hours: number) => {
    for (const w of Object.values(worlds.current!)) {
      w.now += hours * 3600 * 1000;
      w.session += 1;
      w.features.forEach((f) => f.visit(`s${w.session}`));
    }
    setDays((d) => d + hours / 24);
    rerender();
  };

  const act = (mode: Mode, index: number, event: FeatureEvent) => {
    const w = worlds.current![mode];
    if (mode === 'udemy') {
      // document.dispatchEvent(new CustomEvent('DISMISS_FOREVER')) → mọi instance đều nghe tên này
      w.features.forEach((f) => f.dispatch(event));
    } else {
      w.features[index].dispatch(event);
    }
    rerender();
  };

  const reset = () => {
    worlds.current = { udemy: createWorld('udemy', add), ours: createWorld('ours', add) };
    setDays(0);
    add('Bắt đầu lại từ ngày 0');
  };

  return (
    <div className='page ud-discovery'>
      <h1>Gợi ý tính năng qua nhiều phiên</h1>
      <p className='hint'>
        Hai tính năng mới cùng được gợi ý. PASSIVE = banner nhỏ, ACTIVE = modal (sau hơn 3 phiên), PAUSED/DORMANT = im lặng,
        END = thôi hẳn. Người dùng này vào site đều đặn mỗi 20 giờ.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => visitAfter(20)}>
          Vào lại sau 20 giờ
        </button>
        <button onClick={() => visitAfter(3 * 24)}>Vắng 3 ngày</button>
        <button onClick={() => visitAfter(15 * 24)}>Vắng 15 ngày</button>
        <button onClick={reset}>Làm lại</button>
        <span className='muted' data-testid='days'>
          Ngày thứ {days.toFixed(1)}
        </span>
      </div>
      <div className='split'>
        {(['udemy', 'ours'] as Mode[]).map((mode) => (
          <Panel key={mode} mode={mode} world={worlds.current![mode]} onAct={act} />
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

function Panel({ mode, world, onAct }: { mode: Mode; world: World; onAct: (m: Mode, i: number, e: FeatureEvent) => void }) {
  const label = mode === 'udemy' ? 'Kiểu Udemy (mô phỏng)' : 'Bản viết lại';
  const items = useMemo(() => FEATURES.map((f, i) => ({ f, i })), []);
  return (
    <div className='card' data-testid={`panel-${mode}`}>
      <h2>{label}</h2>
      {items.map(({ f, i }) => {
        const feat = world.features[i];
        return (
          <div key={f.id} className='ud-discovery-feature' data-testid={`${mode}-${f.id}`}>
            <div className='ud-discovery-head'>
              <b>{f.name}</b>
              <span className={`badge ud-state-${feat.state.toLowerCase()}`} data-testid={`${mode}-${f.id}-state`}>
                {feat.state}
              </span>
              <span className='muted' data-testid={`${mode}-${f.id}-count`}>
                {feat.sessionCount} phiên
              </span>
            </div>
            {feat.visible && (
              <div className={`ud-discovery-ui ${feat.state === 'ACTIVE' ? 'is-modal' : ''}`}>
                <span>{feat.state === 'ACTIVE' ? `Thử "${f.name}" ngay?` : `Mới: ${f.name}`}</span>
                <span className='ud-discovery-actions'>
                  <button onClick={() => onAct(mode, i, 'DESIRED_ACTION')}>Thử ngay</button>
                  <button onClick={() => onAct(mode, i, feat.state === 'ACTIVE' ? 'DELAY_TO_PAUSED' : 'DELAY_TO_DORMANT')}>Để sau</button>
                  <button onClick={() => onAct(mode, i, 'DISMISS_FOREVER')} data-testid={`${mode}-${f.id}-dismiss`}>
                    Không hiện nữa
                  </button>
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}


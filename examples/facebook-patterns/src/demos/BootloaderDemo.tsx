import { useMemo, useRef, useState } from 'react';
import {
  ResourceBitmap,
  createConsistencyChecker,
  decodeCompressed,
  type ConsistencyPayload,
  type ModuleRegistry,
  type RefreshLevel,
} from '../lib/resourceBitmap';
import { Log, Stat, useLog } from './shared';
import './BootloaderDemo.css';

const TOTAL = 600;
// Tài nguyên được cấp số theo gói, nên mỗi màn hình tải một vài dải liền nhau
const SCREENS: Record<string, Array<[number, number]>> = {
  'Khung trang (luôn có)': [[0, 120]],
  'Bảng tin': [[120, 210], [400, 420]],
  Messenger: [[210, 300], [420, 440]],
  'Trình phát video': [[300, 360]],
  Marketplace: [[460, 560]],
};

function BitmapPart() {
  const bitmap = useRef(new ResourceBitmap());
  const [loaded, setLoaded] = useState<string[]>([]);
  const [, force] = useState(0);

  const load = (name: string) => {
    SCREENS[name].forEach(([from, to]) => {
      for (let i = from; i < to; i++) bitmap.current.set(i);
    });
    setLoaded((l) => (l.includes(name) ? l : [...l, name]));
  };
  const loadRandom = () => {
    for (let k = 0; k < 40; k++) bitmap.current.set(Math.floor(Math.random() * TOTAL));
    force((n) => n + 1);
  };

  const compressed = bitmap.current.toCompressedString();
  const raw = bitmap.current.toRawString();
  const decoded = useMemo(() => decodeCompressed(compressed), [compressed]);
  const roundTrip = decoded.every((bit, i) => bit === (bitmap.current.has(i) ? 1 : 0)) && decoded.length === bitmap.current.length;

  return (
    <section className='card'>
      <h3>1. Báo server "tôi đã có những gì"</h3>
      <div className='toolbar'>
        {Object.keys(SCREENS).map((name) => (
          <button key={name} className={loaded.includes(name) ? 'primary' : ''} onClick={() => load(name)}>
            {name}
          </button>
        ))}
        <button onClick={loadRandom}>Thêm 40 tài nguyên rải rác</button>
      </div>
      <div className='bl-grid' aria-hidden>
        {Array.from({ length: TOTAL }, (_, i) => (
          <i key={i} className={bitmap.current.has(i) ? 'on' : ''} />
        ))}
      </div>
      <div className='stats'>
        <Stat label='bitmap thô (ký tự)' value={raw.length} />
        <Stat label='RLE + Elias-gamma (ký tự)' value={compressed.length} />
        <Stat label='giải nén lại khớp' value={roundTrip ? 'đúng' : 'SAI'} />
      </div>
      <code className='bl-code' data-testid='compressed'>
        {compressed || '(chưa tải gì)'}
      </code>
    </section>
  );
}

const MODULES = ['Composer', 'Payments', 'VideoPlayer', 'Chat'];

class FakeRegistry implements ModuleRegistry {
  loaded = new Set<string>();
  private listeners = new Map<string, Array<() => void>>();
  onLoaded(name: string, callback: () => void) {
    if (this.loaded.has(name)) callback();
    else this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  load(name: string) {
    if (this.loaded.has(name)) return;
    this.loaded.add(name);
    (this.listeners.get(name) ?? []).forEach((cb) => cb());
    this.listeners.delete(name);
  }
}

/** Mô phỏng ClientConsistency bản gốc: mỗi module chỉ được theo dõi MỘT lần cả vòng đời tab. */
function createFbStyleChecker(registry: ModuleRegistry, emit: (level: RefreshLevel, reason: string) => void) {
  const maxLevel: Record<string, number> = {};
  const watched = new Set<string>();
  return (payload: ConsistencyPayload) => {
    const keys = Object.keys(payload.actions).sort().reverse();
    for (const key of keys) {
      const level = Number(key);
      const modules = payload.actions[key] ?? [];
      if (modules.length === 0) {
        emit(level === 3 ? 'hard' : 'soft', '*');
        break;
      }
      for (const m of modules) {
        maxLevel[m] = Math.max(maxLevel[m] ?? 0, level);
        if (watched.has(m)) continue; // bản gốc: `if (l.has(a)) return`
        watched.add(m);
        registry.onLoaded(m, () => {
          if (maxLevel[m] === 2) emit('soft', m);
          if (maxLevel[m] === 3) emit('hard', m);
        });
      }
    }
  };
}

function ConsistencyPart() {
  const { lines, add } = useLog(30);
  const setup = useMemo(() => {
    const registry = new FakeRegistry();
    registry.load('Chat');
    registry.load('Composer');
    const fixed = createConsistencyChecker(1, registry, (level, reason) =>
      add(`[viết lại] ${level === 'hard' ? 'HARD refresh' : 'soft refresh'} vì ${reason}`, level === 'hard' ? 'err' : 'warn'),
    );
    const fb = createFbStyleChecker(registry, (level, reason) =>
      add(`[kiểu gốc] ${level === 'hard' ? 'HARD refresh' : 'soft refresh'} vì ${reason}`, 'muted'),
    );
    return { registry, handle: (p: ConsistencyPayload) => (fixed(p), fb(p)) };
  }, [add]);
  const [, force] = useState(0);

  const deploy = (payload: ConsistencyPayload, label: string) => {
    add(`Server deploy rev ${payload.rev}: ${label}`);
    setup.handle(payload);
    force((n) => n + 1);
  };

  return (
    <section className='card'>
      <h3>2. Deploy mới: chỉ reload khi code đang dùng bị đổi</h3>
      <p className='hint'>Tab đang dùng Chat và Composer. Payments, VideoPlayer chưa nạp.</p>
      <div className='toolbar'>
        <button onClick={() => deploy({ rev: 2, actions: { '2': ['VideoPlayer'] } }, 'VideoPlayer đổi (soft)')}>
          Deploy: VideoPlayer đổi
        </button>
        <button onClick={() => deploy({ rev: 3, actions: { '2': ['Composer'] } }, 'Composer đổi (soft)')}>
          Deploy: Composer đổi (soft)
        </button>
        <button onClick={() => deploy({ rev: 4, actions: { '3': ['Composer'] } }, 'Composer đổi API (hard)')}>
          Deploy: Composer cần hard
        </button>
        <button onClick={() => deploy({ rev: 5, actions: { '3': ['Payments'] } }, 'Payments đổi (hard)')}>
          Deploy: Payments đổi
        </button>
      </div>
      <div className='toolbar'>
        {MODULES.map((m) => (
          <button
            key={m}
            disabled={setup.registry.loaded.has(m)}
            onClick={() => {
              add(`Người dùng mở tính năng dùng ${m} -> nạp module`);
              setup.registry.load(m);
              force((n) => n + 1);
            }}
          >
            {setup.registry.loaded.has(m) ? `${m} ✓` : `Nạp ${m}`}
          </button>
        ))}
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function BootloaderDemo() {
  return (
    <div className='page'>
      <h1>Bootloader: bitmap tài nguyên và client consistency</h1>
      <BitmapPart />
      <ConsistencyPart />
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import {
  AutoplayGate,
  BandwidthEstimator,
  bps,
  createBandwidthMeter,
  estimateBandwidth,
  metaEstimate,
  type BandwidthSample,
  type BandwidthStore,
} from '../lib/bandwidthEwma';
import { Log, Stat, sleep, useLog } from './shared';
import './BandwidthEwmaDemo.css';

const PROFILES = {
  stable: { label: 'Ổn định 4 Mbps', base: 4_000_000, jitter: 0.05 },
  wobbly: { label: 'Dao động 1–6 Mbps', base: 3_500_000, jitter: 0.7 },
  slow: { label: 'Chậm 400 kbps', base: 400_000, jitter: 0.15 },
  awful: { label: 'Rất chậm 90 kbps', base: 90_000, jitter: 0.2 },
} as const;
type ProfileKey = keyof typeof PROFILES;

const SEGMENT_BYTES = 160_000;
const CHUNK = 16_000;
const DEFAULT_BPS = 500_000;

const kbps = (v: number | null) =>
  v == null || Number.isNaN(v)
    ? 'NaN'
    : Math.abs(v) >= 1e6
      ? `${(v / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} Mbps`
      : `${Math.round(v / 1000)} kbps`;

/** Stream giả lập: phát chunk 16 KB với độ trễ ứng với băng thông của profile. */
function fakeSegmentStream(bitsPerSec: number, jitter: number) {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (sent >= SEGMENT_BYTES) return controller.close();
      const speed = bitsPerSec * (1 + (Math.random() * 2 - 1) * jitter);
      await sleep((CHUNK * 8 * 1000) / Math.max(speed, 10_000));
      sent += CHUNK;
      controller.enqueue(new Uint8Array(CHUNK));
    },
  });
}

interface Point {
  meta: number;
  ours: number;
  sample: number;
}

export default function BandwidthEwmaDemo() {
  const { lines, add } = useLog(40);
  const store = useRef(new Map<string, string>());
  const fakeStore: BandwidthStore = useMemo(
    () => ({ get: (k) => store.current.get(k) ?? null, set: (k, v) => void store.current.set(k, v) }),
    [],
  );
  const make = () => new BandwidthEstimator({ store: fakeStore, defaultBps: DEFAULT_BPS });
  const ours = useRef(make());
  const metaCache = useRef<number | null>(null);
  const gate = useRef(new AutoplayGate());
  const [profile, setProfile] = useState<ProfileKey>('stable');
  const [points, setPoints] = useState<Point[]>([]);
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);

  const samples = ours.current.getSamples();
  const metaRaw = samples.length ? metaEstimate([...samples]) : NaN;
  const metaUsed = metaRaw > 0 ? metaRaw : metaCache.current ?? DEFAULT_BPS;
  const mine = ours.current.estimate();
  const [restrained, setRestrained] = useState(false);

  const record = (s: BandwidthSample, label: string) => {
    ours.current.addSample(s);
    const all = [...ours.current.getSamples()];
    const meta = metaEstimate(all);
    const now = ours.current.estimate();
    const fast = estimateBandwidth(all, { halfLifeSec: 1.5 }); // EWMA nhanh cho cổng autoplay
    setRestrained(gate.current.update(now.source === 'samples' ? now.bps : null, fast));
    setPoints((p) => [...p, { meta: meta > 0 ? meta : metaCache.current ?? DEFAULT_BPS, ours: now.bps, sample: bps(s) }].slice(-40));
    add(
      `${label}: ${kbps(bps(s))} → gốc ${meta > 0 ? kbps(meta) : `${kbps(meta)} ⇒ dùng ${kbps(metaCache.current ?? DEFAULT_BPS)}`}, viết lại ${kbps(now.bps)}`,
      meta > 0 ? undefined : 'warn',
    );
  };

  const download = async (count: number) => {
    setBusy(true);
    const p = PROFILES[profile];
    for (let i = 0; i < count; i++) {
      const meter = createBandwidthMeter((s) => record(s, 'mẫu'), { bytesPerSample: SEGMENT_BYTES });
      const reader = fakeSegmentStream(p.base, p.jitter).pipeThrough(meter).getReader();
      while (!(await reader.read()).done);
    }
    setBusy(false);
  };

  const burst = () => record({ bytes: 5_000_000, ms: 50 }, 'cache hit 5 MB/50 ms');

  const reopen = () => {
    const saved = ours.current.persist();
    metaCache.current = metaUsed; // bản gốc ghi String(getAdjustedBandwidth()) lúc unload, kể cả khi đó là số dự phòng
    ours.current = make();
    setPoints([]);
    add(
      `Đóng/mở lại tab: gốc lưu ${kbps(metaUsed)}${metaRaw > 0 ? '' : ' (là số dự phòng!)'}; viết lại ${saved ? 'lưu số đo thật' : 'không có số đo, không ghi'}`,
      metaRaw > 0 ? 'ok' : 'warn',
    );
    force((n) => n + 1);
  };

  const reset = () => {
    store.current.clear();
    metaCache.current = null;
    ours.current = make();
    gate.current = new AutoplayGate();
    setRestrained(false);
    setPoints([]);
    add('Xoá mẫu và bộ nhớ', 'muted');
  };

  return (
    <div className='page bwe'>
      <h1>Ước lượng băng thông EWMA</h1>
      <p className='hint'>
        Tải segment qua <code>TransformStream</code> đếm byte. Cùng một dãy mẫu đi vào công thức gốc của oz-player và bản viết lại.
        Thử "Ổn định" rồi tải 1 segment: gốc ra <b>NaN</b> vì độ lệch chuẩn bằng 0. Sau đó chèn một mẫu cache hit.
      </p>
      <div className='toolbar'>
        <select value={profile} onChange={(e) => setProfile(e.target.value as ProfileKey)} disabled={busy}>
          {Object.entries(PROFILES).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <button className='primary' onClick={() => download(1)} disabled={busy}>
          Tải 1 segment
        </button>
        <button onClick={() => download(5)} disabled={busy}>
          Tải 5 segment
        </button>
        <button onClick={burst} disabled={busy}>
          Chèn cache hit
        </button>
        <button onClick={reopen} disabled={busy}>
          Đóng rồi mở lại tab
        </button>
        <button onClick={reset} disabled={busy}>
          Xoá
        </button>
      </div>
      <div className='stats'>
        <Stat label={`Gốc (thô ${kbps(metaRaw)})`} value={<b className={metaRaw > 0 ? '' : 'warn'}>{kbps(metaUsed)}</b>} />
        <Stat label={`Viết lại (nguồn: ${mine.source})`} value={<b className='ok'>{kbps(mine.bps)}</b>} />
        <Stat label='Số mẫu (tối đa 15)' value={samples.length} />
        <Stat label='Autoplay (ngưỡng 123 kbps)' value={<b className={restrained ? 'err' : 'ok'}>{restrained ? 'hạn chế' : 'cho phép'}</b>} />
      </div>
      <Chart points={points} />
      <Log lines={lines} />
    </div>
  );
}

function Chart({ points }: { points: Point[] }) {
  const w = 600;
  const h = 150;
  if (points.length === 0) return <div className='card bwe-empty muted'>Chưa có mẫu</div>;
  const max = Math.max(...points.flatMap((p) => [p.meta, p.ours, Math.min(p.sample, 10_000_000)]), 1);
  const x = (i: number) => (points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 20) + 10);
  const y = (v: number) => h - 10 - (Math.min(v, max) / max) * (h - 20);
  const line = (key: 'meta' | 'ours') => points.map((p, i) => `${x(i)},${y(p[key])}`).join(' ');
  return (
    <div className='card bwe-chart'>
      <svg viewBox={`0 0 ${w} ${h}`} role='img' aria-label='Biểu đồ ước lượng băng thông'>
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.sample)} r={3} className='bwe-dot' />
        ))}
        <polyline points={line('meta')} className='bwe-meta' />
        <polyline points={line('ours')} className='bwe-ours' />
      </svg>
      <div className='bwe-legend'>
        <span className='bwe-k-dot'>mẫu đo</span>
        <span className='bwe-k-meta'>gốc (sau dự phòng)</span>
        <span className='bwe-k-ours'>viết lại</span>
        <span className='muted'>trục y tới {kbps(max)}</span>
      </div>
    </div>
  );
}

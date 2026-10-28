import { useEffect, useRef, useState } from 'react';
import { TaggedRanges, coveredSeconds, mergeRanges, nextRangeIndex, planGapJump, rangeIndexAt, type Range } from '../lib/taggedRanges';
import { LegacyTaggedRanges } from './taggedRangesLegacy';
import { Stat } from './shared';
import './TaggedRangesDemo.css';

type Op = { add: [number, number, string] } | { get: number };
const SCENARIOS: { key: string; label: string; ops: Op[] }[] = [
  { key: 'split', label: 'Chèn vào giữa', ops: [{ add: [0, 30, '360p'] }, { add: [10, 20, '720p'] }] },
  { key: 'cover', label: 'Phủ trọn đoạn cũ', ops: [{ add: [10, 20, '720p'] }, { add: [0, 30, '1080p'] }] },
  { key: 'order', label: 'Phủ trọn, có đoạn phía sau', ops: [{ add: [10, 20, '720p'] }, { add: [25, 27, '360p'] }, { add: [0, 30, '1080p'] }] },
  { key: 'bridge', label: 'Nối hai đoạn cùng nhãn', ops: [{ add: [0, 5, '720p'] }, { add: [5, 10, '360p'] }, { add: [10, 15, '720p'] }, { add: [15, 20, '1080p'] }, { add: [5, 10, '720p'] }] },
  { key: 'cursor', label: 'Con trỏ cũ sau add', ops: [{ add: [0, 5, '720p'] }, { add: [5, 10, '360p'] }, { add: [10, 20, '1080p'] }, { get: 15 }, { add: [0, 10, '720p'] }, { get: 16 }] },
];
const TAGS = ['360p', '720p', '1080p'];
const D = 32;

function Track({ ranges, label, domain, children }: { ranges: readonly { start: number; end: number; tag?: string }[]; label: string; domain: number; children?: React.ReactNode }) {
  return (
    <div className='trd-row'>
      <span className='trd-label'>{label}</span>
      <div className='trd-track'>
        {ranges.map((r, i) => (
          <div
            key={i}
            className={`trd-seg${r.tag ? ` tag-${r.tag}` : ''}`}
            style={{ left: `${(r.start / domain) * 100}%`, width: `${((r.end - r.start) / domain) * 100}%`, top: r.tag ? `${(i % 2) * 3}px` : undefined }}
            title={`${r.start}–${r.end}${r.tag ? ' ' + r.tag : ''}`}
          >
            {r.tag && r.end - r.start >= 3 ? r.tag : ''}
          </div>
        ))}
        {children}
      </div>
    </div>
  );
}

function TagTab() {
  const mine = useRef(new TaggedRanges<string>());
  const legacy = useRef(new LegacyTaggedRanges());
  const [, setVer] = useState(0);
  const [gets, setGets] = useState<string[]>([]);
  const [probe, setProbe] = useState(12.5);
  const [form, setForm] = useState({ start: 4, end: 14, tag: '1080p' });

  const run = (ops: Op[], reset: boolean) => {
    if (reset) {
      mine.current = new TaggedRanges<string>();
      legacy.current = new LegacyTaggedRanges();
    }
    const out: string[] = [];
    for (const op of ops) {
      if ('add' in op) {
        mine.current.add(...op.add);
        legacy.current.add(...op.add);
      } else {
        const a = legacy.current.get(op.get);
        const b = mine.current.get(op.get);
        out.push(`get(${op.get}) → gốc: ${a ?? 'null'}, viết lại: ${b ?? 'null'}`);
      }
    }
    setGets(reset ? out : (g) => [...g, ...out]);
    setVer((v) => v + 1);
  };
  useEffect(() => run(SCENARIOS[1].ops, true), []);

  const L = legacy.current.list;
  const overlap = L.some((r, i) => L.some((s, j) => i !== j && r.start < s.end && s.start < r.end));
  const unsorted = L.some((r, i) => i > 0 && r.start < L[i - 1].start);
  const fmt = (rs: readonly { start: number; end: number; tag: string }[]) => rs.map((r) => `${r.tag} ${r.start}–${r.end}`).join(', ') || '(rỗng)';
  // Probe trên bản sao để không làm đổi con trỏ của kịch bản.
  const probeLegacy = Object.assign(new LegacyTaggedRanges(), { list: L.map((r) => ({ ...r })) }).get(probe);
  const probeMine = mine.current.get(probe);

  return (
    <>
      <p className='hint'>
        Mỗi lần append một segment, trình phát ghi lại "khoảng [start, end) đang chứa chất lượng nào". Bấm một kịch bản: dòng trên là thuật toán của bản gốc (mô phỏng lại, đã đối chiếu với code gốc), dòng dưới là bản viết lại.
      </p>
      <div className='toolbar'>
        {SCENARIOS.map((s) => (
          <button key={s.key} onClick={() => run(s.ops, true)}>
            {s.label}
          </button>
        ))}
      </div>
      <div className='toolbar trd-form'>
        <select value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} aria-label='Nhãn'>
          {TAGS.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <label>
          từ <input type='number' min={0} max={D} value={form.start} onChange={(e) => setForm({ ...form, start: Number(e.target.value) })} />
        </label>
        <label>
          tới <input type='number' min={0} max={D} value={form.end} onChange={(e) => setForm({ ...form, end: Number(e.target.value) })} />
        </label>
        <button className='primary' onClick={() => run([{ add: [form.start, form.end, form.tag] }], false)}>
          add()
        </button>
      </div>
      <div className='card'>
        <Track ranges={L} label='Bản gốc' domain={D}>
          <i className='trd-probe' style={{ left: `${(probe / D) * 100}%` }} />
        </Track>
        <Track ranges={mine.current.ranges()} label='Viết lại' domain={D}>
          <i className='trd-probe' style={{ left: `${(probe / D) * 100}%` }} />
        </Track>
        <div className='trd-axis'>
          {[0, 8, 16, 24, 32].map((x) => (
            <span key={x} style={{ left: `${(x / D) * 100}%` }}>
              {x}s
            </span>
          ))}
        </div>
        <label className='trd-probe-label'>
          <span>
            get(<b>{probe.toFixed(1)}</b>) → gốc: <b className={probeLegacy === probeMine ? '' : 'err'}>{probeLegacy ?? 'null'}</b>, viết lại: <b className='ok'>{probeMine ?? 'null'}</b>
          </span>
          <input type='range' min={0} max={D} step={0.5} value={probe} onChange={(e) => setProbe(Number(e.target.value))} />
        </label>
      </div>
      <div className='trd-lists'>
        <div className={`card${overlap || unsorted ? ' trd-bad' : ''}`}>
          <b>Bản gốc</b> <span className='muted'>({L.length} đoạn)</span>
          <p className='trd-mono'>{fmt(L)}</p>
          {overlap && <p className='err trd-small'>Có hai đoạn chồng nhau: get() trả nhãn của đoạn đứng trước trong mảng.</p>}
          {unsorted && <p className='err trd-small'>Mảng không còn sắp xếp theo start.</p>}
        </div>
        <div className='card'>
          <b>Viết lại</b> <span className='muted'>({mine.current.ranges().length} đoạn)</span>
          <p className='trd-mono'>{fmt(mine.current.ranges())}</p>
        </div>
      </div>
      {gets.length > 0 && (
        <div className='log trd-gets'>
          {gets.map((g, i) => (
            <div key={i} className={/gốc: null/.test(g) && !/viết lại: null/.test(g) ? 'err' : ''}>
              {g}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ---------- Tab 2: nhảy qua lỗ buffer ----------

const BUFFERED: Range[] = [
  { start: 0, end: 8 },
  { start: 8.4, end: 16 },
  { start: 19, end: 30 },
];
const SLACK = 0.1;
const NEAR = 1.5;
type Policy = 'none' | 'legacy' | 'mine';
interface Sim {
  t: number;
  stalledFor: number;
  stalledTotal: number;
  skipped: number;
  jumps: { from: number; to: number }[];
  done: boolean;
}
const newSim = (): Sim => ({ t: 0, stalledFor: 0, stalledTotal: 0, skipped: 0, jumps: [], done: false });

/** Trình phát giả: chạy khi currentTime nằm trong khoảng có dữ liệu, đứng yên ở mép khoảng. */
function step(s: Sim, dt: number, policy: Policy): Sim {
  if (s.done) return s;
  const ranges = mergeRanges(BUFFERED);
  const cur = ranges.find((r) => s.t >= r.start && s.t < r.end);
  let t = s.t;
  let stalledFor = s.stalledFor;
  let stalledTotal = s.stalledTotal;
  if (cur) {
    t = Math.min(cur.end, t + dt);
    stalledFor = 0;
  } else {
    stalledFor += dt;
    stalledTotal += dt;
  }
  let to: number | null = null;
  if (policy === 'legacy') {
    // isNearGap || isInGap, không cần biết có đang kẹt hay không.
    const i = rangeIndexAt(t, ranges);
    const n = nextRangeIndex(t, ranges);
    const near = i !== -1 && ranges[i].end - t < NEAR;
    if ((near || i === -1) && n !== -1) to = ranges[n].start + SLACK;
  } else if (policy === 'mine') {
    const plan = planGapJump(t, ranges, { slack: SLACK, nearGapSec: NEAR, maxGapSec: 0 }, stalledFor >= 0.3);
    if (plan) to = plan.to;
  }
  const next: Sim = { ...s, t, stalledFor, stalledTotal };
  if (to != null && to > t + 0.05) {
    next.skipped += coveredSeconds(t, to, ranges);
    next.jumps = [...s.jumps, { from: t, to }];
    next.t = to;
    next.stalledFor = 0;
  }
  next.done = next.t >= 29.99 || next.stalledTotal > 6;
  return next;
}

const POLICIES: { key: Policy; label: string; note: string }[] = [
  { key: 'none', label: 'Không nhảy', note: 'kẹt ở mép lỗ đầu tiên' },
  { key: 'legacy', label: 'Bản gốc', note: 'nhảy khi còn < 1,5 s là hết khoảng' },
  { key: 'mine', label: 'Viết lại', note: 'chỉ nhảy khi đã đứng yên 0,3 s' },
];

function GapTab() {
  const [sims, setSims] = useState<Record<Policy, Sim>>({ none: newSim(), legacy: newSim(), mine: newSim() });
  const [running, setRunning] = useState(false);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setSims((prev) => {
        const next = { none: step(prev.none, 0.1, 'none'), legacy: step(prev.legacy, 0.1, 'legacy'), mine: step(prev.mine, 0.1, 'mine') };
        if (next.none.done && next.legacy.done && next.mine.done) setRunning(false);
        return next;
      });
    }, 25);
    return () => clearInterval(id);
  }, [running]);

  return (
    <>
      <p className='hint'>
        Buffer có hai lỗ: 8,0–8,4 s và 16–19 s. Ba trình phát giả cùng phát (nhanh gấp 4 lần). Trình phát dừng ở mép lỗ như trình duyệt thật; chính sách nhảy quyết định nó có
        thoát ra được không và có bỏ qua đoạn đã tải không.
      </p>
      <div className='toolbar'>
        <button className='primary' disabled={running} onClick={() => setRunning(true)}>
          Phát
        </button>
        <button
          onClick={() => {
            setRunning(false);
            setSims({ none: newSim(), legacy: newSim(), mine: newSim() });
          }}
        >
          Làm lại
        </button>
      </div>
      <div className='card'>
        {POLICIES.map((p) => {
          const s = sims[p.key];
          return (
            <Track key={p.key} ranges={BUFFERED} label={p.label} domain={D}>
              {s.jumps.map((j, i) => (
                <div key={i} className='trd-skip' style={{ left: `${(j.from / D) * 100}%`, width: `${((j.to - j.from) / D) * 100}%` }} />
              ))}
              <i className={`trd-head${s.stalledFor > 0 ? ' stalled' : ''}`} style={{ left: `${(s.t / D) * 100}%` }} />
            </Track>
          );
        })}
        <div className='trd-axis'>
          {[0, 8, 16, 24, 32].map((x) => (
            <span key={x} style={{ left: `${(x / D) * 100}%` }}>
              {x}s
            </span>
          ))}
        </div>
      </div>
      <div className='trd-lists'>
        {POLICIES.map((p) => {
          const s = sims[p.key];
          return (
            <div key={p.key} className={`card${s.done && s.t >= 29.99 && s.skipped < 0.5 ? ' active' : ''}`} data-policy={p.key}>
              <b>{p.label}</b> <span className='muted'>{p.note}</span>
              <div className='stats trd-stats'>
                <Stat label='currentTime' value={`${s.t.toFixed(1)} s`} />
                <Stat label='Thời gian kẹt' value={`${s.stalledTotal.toFixed(1)} s`} />
                <Stat label='Đã tải mà bỏ qua' value={<span className={s.skipped > 0.5 ? 'err' : 'ok'}>{s.skipped.toFixed(1)} s</span>} />
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default function TaggedRangesDemo() {
  const [tab, setTab] = useState<'tags' | 'gaps'>('tags');
  return (
    <div className='page trd'>
      <h1>Khoảng thời gian gắn nhãn và lỗ buffer</h1>
      <div className='trd-tabs' role='tablist'>
        <button role='tab' aria-selected={tab === 'tags'} className={tab === 'tags' ? 'primary' : ''} onClick={() => setTab('tags')}>
          Bảng nhãn theo thời gian
        </button>
        <button role='tab' aria-selected={tab === 'gaps'} className={tab === 'gaps' ? 'primary' : ''} onClick={() => setTab('gaps')}>
          Nhảy qua lỗ buffer
        </button>
      </div>
      {tab === 'tags' ? <TagTab /> : <GapTab />}
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { AppendQueue, VideoSyncer, type SourceBufferLike, type VideoLike } from '../lib/videoSync';
import { Log, Stat, useLog } from './shared';
import './VideoSyncDemo.css';

// ---------- Tab 1: append vào SourceBuffer ----------

/** SourceBuffer giả: mỗi lần append tốn 6 ms cố định + thời gian theo số byte, đang bận thì ném InvalidStateError như thật. */
class FakeSourceBuffer extends EventTarget implements SourceBufferLike {
  updating = false;
  appendedBytes = 0;
  calls = 0;
  rejected = 0;
  appendBuffer(data: ArrayBufferView | ArrayBuffer) {
    if (this.updating) {
      this.rejected++;
      throw new DOMException("Failed to execute 'appendBuffer' on 'SourceBuffer': This SourceBuffer is still processing", 'InvalidStateError');
    }
    this.updating = true;
    this.calls++;
    this.appendedBytes += data.byteLength;
    setTimeout(() => {
      this.updating = false;
      this.dispatchEvent(new Event('update'));
      this.dispatchEvent(new Event('updateend'));
    }, 6 + data.byteLength / 20_000);
  }
  abort() {
    this.updating = false;
  }
}

const CHUNK = 4 * 1024;
const CHUNKS = 96;
const TOTAL = CHUNK * CHUNKS;
/** Như dữ liệu từ mạng: mỗi chunk là subarray của một vùng đệm 64 KB dùng lại. */
function networkStream(ownBuffers = false): ReadableStream<Uint8Array> {
  const pool = new Uint8Array(64 * 1024);
  let i = 0;
  return new ReadableStream({
    pull: async (c) => {
      if (i === CHUNKS) return c.close();
      await new Promise((r) => setTimeout(r, 1));
      const off = (i * CHUNK) % pool.length;
      pool.fill(i & 0xff, off, off + CHUNK);
      c.enqueue(ownBuffers ? pool.slice(off, off + CHUNK) : pool.subarray(off, off + CHUNK));
      i++;
    },
  });
}

/** Mô phỏng nhánh đọc stream của bản gốc: `chunk.buffer` + nối ArrayBuffer sau mỗi chunk. */
async function legacyAppendStream(sb: FakeSourceBuffer, stream: ReadableStream<Uint8Array>, target: number) {
  const append = (d: ArrayBuffer | Uint8Array) =>
    new Promise<void>((resolve) => {
      sb.addEventListener('updateend', () => resolve(), { once: true });
      sb.appendBuffer(d);
    });
  let acc = new ArrayBuffer(0);
  let copied = 0;
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      if (acc.byteLength > 0) await append(acc);
      break;
    }
    let toAppend: ArrayBuffer | Uint8Array = value;
    if (target > 0) {
      const whole = value.buffer as ArrayBuffer; // cả vùng đệm 64 KB, không phải 4 KB của chunk
      const next = new Uint8Array(acc.byteLength + whole.byteLength);
      next.set(new Uint8Array(acc), 0);
      next.set(new Uint8Array(whole), acc.byteLength);
      copied += next.byteLength;
      acc = next.buffer;
      toAppend = acc;
    }
    if (toAppend.byteLength >= target) {
      acc = new ArrayBuffer(0);
      await append(toAppend);
    }
  }
  return copied;
}

interface Row {
  key: string;
  label: string;
  appends: number;
  bytes: number;
  rejected: number;
  copied: number;
  ms: number;
}

const STRATS: { key: string; label: string }[] = [
  { key: 'naive', label: 'appendBuffer từng chunk, không chờ updateend' },
  { key: 'legacy0', label: 'Bản gốc, appendTarget = 0' },
  { key: 'legacy64', label: 'Bản gốc, appendTarget = 64 KB' },
  { key: 'legacy64own', label: 'Bản gốc, 64 KB, chunk có ArrayBuffer riêng' },
  { key: 'queue0', label: 'AppendQueue, appendTarget = 0' },
  { key: 'queue64', label: 'AppendQueue, appendTarget = 64 KB' },
];

async function runStrategy(key: string): Promise<Row> {
  const sb = new FakeSourceBuffer();
  const t0 = performance.now();
  let copied = 0;
  if (key === 'naive') {
    const reader = networkStream().getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      try {
        sb.appendBuffer(value);
      } catch {
        /* chunk này mất */
      }
    }
    while (sb.updating) await new Promise((r) => setTimeout(r, 2));
  } else if (key.startsWith('legacy')) {
    copied = await legacyAppendStream(sb, networkStream(key === 'legacy64own'), key === 'legacy0' ? 0 : 64 * 1024);
  } else {
    const q = new AppendQueue(sb, { appendTarget: key === 'queue64' ? 64 * 1024 : 0, readTimeoutMs: 2000 });
    await q.append(networkStream());
    copied = key === 'queue64' ? TOTAL : 0;
  }
  return { key, label: STRATS.find((s) => s.key === key)!.label, appends: sb.calls, bytes: sb.appendedBytes, rejected: sb.rejected, copied, ms: performance.now() - t0 };
}

function AppendTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setRows([]);
    for (const s of STRATS) {
      const r = await runStrategy(s.key);
      setRows((prev) => [...prev, r]);
    }
    setBusy(false);
  };
  const kb = (n: number) => `${Math.round(n / 1024)} KB`;
  return (
    <>
      <p className='hint'>
        Stream mạng giả đưa {CHUNKS} chunk × 4 KB = {kb(TOTAL)}; mỗi chunk là <code>subarray</code> của một vùng đệm 64 KB dùng lại. SourceBuffer giả tốn 6 ms cố định cho mỗi lần
        append và ném <code>InvalidStateError</code> nếu bị gọi khi đang bận, như SourceBuffer thật.
      </p>
      <div className='toolbar'>
        <button className='primary' disabled={busy} onClick={() => void run()}>
          {busy ? 'Đang chạy…' : `Chạy ${STRATS.length} cách`}
        </button>
      </div>
      <div className='card vsd-wrap'>
        <table className='vsd-table'>
          <thead>
            <tr>
              <th>Cách</th>
              <th>Lần append</th>
              <th>Byte đã append</th>
              <th>Bị từ chối</th>
              <th>Byte đã chép</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} data-key={r.key}>
                <td>{r.label}</td>
                <td>{r.appends}</td>
                <td className={r.bytes === TOTAL ? 'ok' : 'err'}>{kb(r.bytes)}</td>
                <td className={r.rejected ? 'err' : ''}>{r.rejected}</td>
                <td className={r.copied > TOTAL * 2 ? 'warn' : ''}>{kb(r.copied)}</td>
                <td>{Math.round(r.ms)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className='muted'>Bấm nút chạy ở trên.</p>}
      </div>
      <p className='muted vsd-small'>
        Đúng phải là {kb(TOTAL)}. "Byte đã chép" là số byte phải sao chép khi gom chunk: bản gốc nối lại toàn bộ phần đã gom mỗi khi có chunk mới.
      </p>
    </>
  );
}

// ---------- Tab 2: đồng bộ video với animation ----------

const DOC = 10; // animation dài 10 s
const FROM = 0.1;
const TO = 0.9;

/** Video giả: currentTime tăng theo playbackRate, trừ lúc bị "lag" (đứng hình giải mã). */
class FakeVideo implements VideoLike {
  currentTime = 0;
  playbackRate = 1;
  paused = true;
  freezeLeft = 0;
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  tick(dt: number) {
    if (this.paused) return;
    if (this.freezeLeft > 0) this.freezeLeft = Math.max(0, this.freezeLeft - dt);
    else this.currentTime += dt * this.playbackRate;
  }
}

/** Mô phỏng KeyframesVideoManager.renderProgress của bản gốc, kể cả debounce chỉ chạy ở lần gọi đầu. */
class LegacySync {
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private v: FakeVideo) {}
  private setRate(r: number) {
    const first = this.timer == null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => (this.timer = null), 100);
    if (first) this.v.playbackRate = r;
  }
  render(p: number) {
    const v = this.v;
    const inside = p >= FROM && p <= TO;
    const target = DOC * (p - FROM);
    const seg = DOC * (TO - FROM);
    if (Math.abs(target - v.currentTime) > 0.2 && v.currentTime < seg && target < seg) {
      const r = (seg - v.currentTime) / (seg - target);
      if (r >= 0.85 && r <= 1.15) this.setRate(r);
    }
    if (inside && v.paused) void v.play();
    else if (!inside && !v.paused) {
      v.pause();
      v.currentTime = 0;
    }
  }
  dispose() {
    if (this.timer) clearTimeout(this.timer);
  }
}

interface Sample {
  t: number;
  a: number | null;
  b: number | null;
}

function SyncTab() {
  const { lines, add } = useLog(30);
  const [, setFrame] = useState(0);
  const sim = useRef<{ va: FakeVideo; vb: FakeVideo; legacy: LegacySync; mine: VideoSyncer; elapsed: number; samples: Sample[]; running: boolean } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const va = new FakeVideo();
    const vb = new FakeVideo();
    const s = (sim.current = { va, vb, legacy: new LegacySync(va), mine: new VideoSyncer(vb, FROM, TO, DOC), elapsed: 0, samples: [] as Sample[], running: true });
    let last = performance.now();
    let raf = 0;
    let frames = 0;
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (s.running) {
        s.elapsed += dt;
        va.tick(dt);
        vb.tick(dt);
        const p = (s.elapsed % DOC) / DOC;
        s.legacy.render(p);
        const act = s.mine.render(p, now);
        if (act?.type === 'rate') add(`[viết lại] playbackRate = ${act.rate.toFixed(3)} (lệch ${act.drift.toFixed(2)} s)`);
        if (act?.type === 'seek') add(`[viết lại] seek tới ${act.to.toFixed(2)} s (lệch ${act.drift.toFixed(2)} s)`, 'warn');
        const inside = p >= FROM && p <= TO;
        const target = DOC * (p - FROM);
        s.samples.push({ t: s.elapsed, a: inside && !va.paused ? va.currentTime - target : null, b: inside && !vb.paused ? vb.currentTime - target : null });
        while (s.samples.length && s.samples[0].t < s.elapsed - DOC) s.samples.shift();
      }
      if (++frames % 3 === 0) setFrame((f) => f + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      s.legacy.dispose();
    };
  }, [add]);

  // Vẽ độ lệch của 10 s gần nhất.
  useEffect(() => {
    const c = canvas.current;
    const s = sim.current;
    if (!c || !s) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = getComputedStyle(c);
    const range = 2.2;
    const y = (d: number) => h / 2 - (d / range) * (h / 2);
    ctx.fillStyle = css.getPropertyValue('--band');
    ctx.fillRect(0, y(0.2), w, y(-0.2) - y(0.2));
    ctx.strokeStyle = css.getPropertyValue('--axis');
    ctx.beginPath();
    ctx.moveTo(0, y(0));
    ctx.lineTo(w, y(0));
    ctx.stroke();
    const x = (t: number) => ((t - (s.elapsed - DOC)) / DOC) * w;
    for (const [key, color] of [
      ['a', css.getPropertyValue('--err')],
      ['b', css.getPropertyValue('--ok')],
    ] as const) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      let pen = false;
      for (const smp of s.samples) {
        const d = smp[key];
        if (d == null) {
          pen = false;
          continue;
        }
        const yy = y(Math.max(-range, Math.min(range, d)));
        if (pen) ctx.lineTo(x(smp.t), yy);
        else ctx.moveTo(x(smp.t), yy);
        pen = true;
      }
      ctx.stroke();
    }
  });

  const s = sim.current;
  const p = s ? (s.elapsed % DOC) / DOC : 0;
  const target = DOC * (p - FROM);
  const inside = p >= FROM && p <= TO;
  const lag = (sec: number) => {
    if (!s) return;
    s.va.freezeLeft = sec;
    s.vb.freezeLeft = sec;
    add(`Gây lag ${sec} s cho cả hai video`, 'warn');
  };
  const drift = (v: FakeVideo) => (inside && !v.paused ? `${(v.currentTime - target).toFixed(2)} s` : '—');

  return (
    <>
      <p className='hint'>
        Animation dài {DOC} s lặp lại; layer video sống trong đoạn 10%–90% (8 s). Mỗi frame, code so <code>video.currentTime</code> với thời điểm lẽ ra phải ở rồi chỉnh{' '}
        <code>playbackRate</code>. Bấm gây lag để video đứng hình giữa chừng.
      </p>
      <div className='toolbar'>
        <button onClick={() => lag(0.6)}>Gây lag 0,6 s</button>
        <button onClick={() => lag(2)}>Gây lag 2 s</button>
        <button
          onClick={() => {
            if (s) s.running = !s.running;
          }}
        >
          {s?.running === false ? 'Chạy tiếp' : 'Tạm dừng'}
        </button>
      </div>
      <div className='vsd-progress' aria-label='Tiến độ animation'>
        <div className='vsd-window' style={{ left: `${FROM * 100}%`, width: `${(TO - FROM) * 100}%` }} />
        <i style={{ left: `${p * 100}%` }} />
      </div>
      <div className='vsd-lanes'>
        {s &&
          [
            { label: 'Bản gốc', v: s.va, cls: 'a' },
            { label: 'Viết lại', v: s.vb, cls: 'b' },
          ].map(({ label, v, cls }) => (
            <div key={cls} className={`card vsd-lane vsd-${cls}`} data-lane={cls}>
              <b>{label}</b>
              <div className='stats'>
                <Stat label='Lệch' value={<span className='vsd-drift'>{drift(v)}</span>} />
                <Stat label='playbackRate' value={<span className='vsd-rate'>{v.playbackRate.toFixed(3)}</span>} />
                <Stat label='Trạng thái' value={v.paused ? 'pause' : v.freezeLeft > 0 ? 'lag' : 'play'} />
              </div>
            </div>
          ))}
      </div>
      <div className='card'>
        <b>Độ lệch video − animation, 10 s gần nhất</b> <span className='muted'>(đỏ: bản gốc, xanh: viết lại, dải mờ: ±0,2 s)</span>
        <canvas ref={canvas} className='vsd-chart' />
      </div>
      <Log lines={lines} />
    </>
  );
}

export default function VideoSyncDemo() {
  const [tab, setTab] = useState<'append' | 'sync'>('append');
  return (
    <div className='page vsd'>
      <h1>SourceBuffer và đồng bộ video</h1>
      <div className='vsd-tabs' role='tablist'>
        <button role='tab' aria-selected={tab === 'append'} className={tab === 'append' ? 'primary' : ''} onClick={() => setTab('append')}>
          Gom chunk cho SourceBuffer
        </button>
        <button role='tab' aria-selected={tab === 'sync'} className={tab === 'sync' ? 'primary' : ''} onClick={() => setTab('sync')}>
          Đồng bộ bằng playbackRate
        </button>
      </div>
      {tab === 'append' ? <AppendTab /> : <SyncTab />}
    </div>
  );
}

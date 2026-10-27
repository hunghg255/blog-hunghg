import { useEffect, useMemo, useRef, useState } from 'react';
import { compactCommands, createVideoCommandQueue, type PlayEvent, type VideoCommand } from '../lib/videoCommandQueue';
import { StreamPool } from '../lib/streamPool';
import { Log, Stat, sleep, useLog } from './shared';
import './VideoQueueDemo.css';

/** WAV 8 giây tự sinh (sóng sin) để <video> có nguồn thật, tua được, không tải file ngoài. */
function makeWavUrl(seconds = 8, rate = 8000) {
  const n = seconds * rate;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin((i / rate) * 2 * Math.PI * 220) * 3000, true);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const BURST: VideoCommand[] = [
  { type: 'play' },
  { type: 'seek', time: 1 },
  { type: 'volume', volume: 0.2 },
  { type: 'pause' },
  { type: 'seek', time: 2 },
  { type: 'play' },
  { type: 'rate', rate: 1.5 },
  { type: 'pause' },
  { type: 'seek', time: 4.5 },
  { type: 'volume', volume: 0.6 },
  { type: 'play' },
];

const fmt = (c: VideoCommand) =>
  c.type === 'seek' ? `seek ${c.time}s` : c.type === 'volume' ? `volume ${c.volume}` : c.type === 'rate' ? `rate ${c.rate}` : c.type === 'muted' ? `muted ${c.muted}` : c.type;

function CommandQueueSection({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = useMemo(() => makeWavUrl(), []);
  const [compact, setCompact] = useState(true);
  const [stats, setStats] = useState({ applied: 0, rejected: 0, state: '—' });
  const [busy, setBusy] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  const run = async () => {
    setBusy(true);
    const video = videoRef.current!;
    video.pause();
    video.currentTime = 0;
    let applied = 0;
    let rejected = 0;
    const queue = createVideoCommandQueue({
      compact,
      desired: () => ({ volume: 0.8, muted: false }),
      onEvent: (e: PlayEvent) => {
        if (e.type === 'applied') {
          applied++;
          add(`áp: ${fmt(e.command)}`, 'muted');
        } else if (e.type === 'play_promise_rejected') {
          rejected++;
          add(`play() #${e.id} bị reject: ${e.reason}`, 'err');
        } else if (e.type === 'play_promise_resolved') add(`play() #${e.id} resolved`, 'ok');
        else if (e.type === 'command_failed') add(`lỗi ${fmt(e.command)}: ${e.error}`, 'err');
        setStats({ applied, rejected, state: '…' });
      },
    });
    // element "chưa sẵn sàng": mọi lệnh vào hàng đợi
    for (const cmd of BURST) queue.send(cmd);
    add(`${BURST.length} lệnh vào hàng đợi khi video chưa gắn`, 'muted');
    await sleep(300);
    queue.attach(video);
    await sleep(500);
    const state = `${video.paused ? 'dừng' : 'đang phát'} @ ${video.currentTime.toFixed(1)}s, vol ${video.volume}, ${video.playbackRate}×`;
    setStats({ applied, rejected, state });
    add(`kết quả (${compact ? 'nén' : 'thô'}): ${state}`, compact ? 'ok' : 'warn');
    video.pause();
    setBusy(false);
  };

  return (
    <section className='card'>
      <h2>Hàng đợi lệnh cho &lt;video&gt;</h2>
      <p className='hint'>
        11 lệnh (play, seek, volume, pause…) được gửi lúc video chưa gắn vào trang. Khi gắn: bản <b>thô</b> chạy lại cả
        chuỗi, các <code>play()</code> bị <code>pause()</code> chen ngang sẽ reject; bản <b>nén</b> chỉ giữ lệnh cuối mỗi
        loại: <code>{compactCommands(BURST).map(fmt).join(', ')}</code>.
      </p>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={compact} onChange={() => setCompact(true)} /> nén lệnh
        </label>
        <label className='switch'>
          <input type='radio' checked={!compact} onChange={() => setCompact(false)} /> chạy thô
        </label>
        <button className='primary' onClick={run} disabled={busy} data-testid='vq-run'>
          Gửi 11 lệnh rồi gắn video
        </button>
      </div>
      <div className='stats'>
        <Stat label='lệnh được áp' value={<output data-testid='vq-applied'>{stats.applied}</output>} />
        <Stat label='play() bị reject' value={<output data-testid='vq-rejected'>{stats.rejected}</output>} />
        <Stat label='trạng thái cuối' value={<output data-testid='vq-state'>{stats.state}</output>} />
      </div>
      <video ref={videoRef} src={url} className='vq-video' preload='auto' playsInline controls />
    </section>
  );
}

function StreamSection({ add }: { add: (t: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [original, setOriginal] = useState(false);
  const [first, setFirst] = useState<string[]>([]);
  const [late, setLate] = useState<string[]>([]);
  const [status, setStatus] = useState('—');

  const scenario = async (kind: 'reorder' | 'errorAfterEarlyComplete') => {
    const pool = new StreamPool<string>({ originalBehavior: original });
    const a: string[] = [];
    const b: string[] = [];
    setFirst([]);
    setLate([]);
    const observer = (out: string[], set: (v: string[]) => void, name: string) => ({
      start: () => {
        out.push('▶ start');
        set([...out]);
      },
      next: (v: string) => {
        out.push(v);
        set([...out]);
      },
      error: (e: unknown) => {
        out.push(`✖ lỗi: ${String(e)}`);
        set([...out]);
        add(`${name}: stream lỗi`, 'err');
      },
      complete: () => {
        out.push('✓ xong');
        set([...out]);
        add(`${name}: stream xong`, 'ok');
      },
    });
    pool.subscribe('feed', observer(a, setFirst, 'người đăng ký đầu'));
    const arrivals: Array<[number, string]> =
      kind === 'reorder'
        ? [
            [2, 'bình luận #3'],
            [0, 'bình luận #1'],
            [3, 'bình luận #4'],
            [1, 'bình luận #2'],
          ]
        : [
            [1, 'bình luận #2'],
            [0, 'bình luận #1'],
          ];
    for (const [seq, text] of arrivals) {
      add(`server gửi seq=${seq} (${text})`, 'muted');
      pool.next('feed', seq, text);
      await sleep(250);
    }
    if (kind === 'reorder') {
      pool.complete('feed', 4);
    } else {
      // complete đến SỚM (seq 5), rồi lỗi thật xảy ra đúng lượt seq 2
      add('server gửi complete seq=5 (đến sớm)', 'muted');
      pool.complete('feed', 5);
      await sleep(250);
      add('server gửi error seq=2', 'muted');
      pool.error('feed', 2, 'timeout ở server');
    }
    await sleep(200);
    pool.subscribe('feed', observer(b, setLate, 'người đăng ký muộn'));
    const s = pool.isDone('feed') ? 'đã đóng' : 'vẫn mở (treo)';
    setStatus(s);
    add(`stream ${s}, pending còn ${pool.pendingCount('feed')}`, pool.isDone('feed') ? 'ok' : 'err');
  };

  return (
    <section className='card'>
      <h2>Stream về lệch thứ tự, phát lại cho người đến muộn</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='radio' checked={!original} onChange={() => setOriginal(false)} /> bản sửa
        </label>
        <label className='switch'>
          <input type='radio' checked={original} onChange={() => setOriginal(true)} /> giống bản gốc
        </label>
        <button className='primary' onClick={() => scenario('reorder')} data-testid='sp-reorder'>
          Chunk về lệch 2,0,3,1
        </button>
        <button onClick={() => scenario('errorAfterEarlyComplete')} data-testid='sp-error'>
          Complete đến sớm rồi lỗi
        </button>
      </div>
      <div className='stats'>
        <Stat label='trạng thái stream' value={<output data-testid='sp-status'>{status}</output>} />
      </div>
      <div className='split'>
        <div className='vq-list' data-testid='sp-first'>
          <b>Người đăng ký đầu</b>
          <ol>
            {first.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
        <div className='vq-list' data-testid='sp-late'>
          <b>Người đăng ký muộn</b>
          <ol>
            {late.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

export default function VideoQueueDemo() {
  const { lines, add } = useLog(40);
  return (
    <div className='page'>
      <h1>Hàng đợi lệnh video và stream sắp lại chunk</h1>
      <div className='vq-wrap'>
        <CommandQueueSection add={add} />
        <StreamSection add={add} />
      </div>
      <Log lines={lines} />
    </div>
  );
}

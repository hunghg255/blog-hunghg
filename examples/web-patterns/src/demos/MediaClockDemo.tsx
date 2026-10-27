import { useEffect, useMemo, useRef, useState } from 'react';
import {
  animationTarget,
  createMasterClock,
  createWatchTimeTracker,
  type SyncTarget,
} from '../lib/mediaClock';
import { Log, Stat, sleep, useLog } from './shared';
import './MediaClockDemo.css';

// ---------------------------------------------------------------------------
// Phần 1: đếm thời gian xem
// ---------------------------------------------------------------------------

function WatchTime() {
  const { lines, add } = useLog(30);
  const [playing, setPlaying] = useState(false);
  const [, force] = useState(0);
  const serverDownRef = useRef(false);
  // đồng hồ giả: performance.now() + phần "tua" khi giả lập máy ngủ
  const skewRef = useRef(0);
  const naiveRef = useRef({ last: null as number | null, total: 0 });
  const sentRef = useRef(0);

  const tracker = useMemo(() => {
    const now = () => performance.now() + skewRef.current;
    return createWatchTimeTracker({
      flushEvery: 5000, // demo: 5s cho nhanh thấy (Skillshare: 15s)
      now,
      onDiscard: (gap) => add(`⏭️ bỏ qua khoảng ${(gap / 1000).toFixed(1)}s (máy ngủ / player treo)`, 'warn'),
      send: async (seconds) => {
        await sleep(400);
        if (serverDownRef.current) {
          add(`❌ gửi ${seconds}s lỗi, giữ lại để gửi lần sau`, 'err');
          throw new Error('500');
        }
        sentRef.current += seconds;
        add(`✅ POST trackTime { elapsed: ${seconds} }`, 'ok');
      },
    });
  }, [add]);

  // "player" giả: bắn timeupdate mỗi 250ms khi đang phát
  useEffect(() => {
    if (!playing) return;
    const now = () => performance.now() + skewRef.current;
    tracker.start();
    naiveRef.current.last = now();
    const id = setInterval(() => {
      tracker.tick();
      const t = now();
      const naive = naiveRef.current;
      if (naive.last !== null) naive.total += t - naive.last;
      naive.last = t;
      force((n) => n + 1);
    }, 250);
    return () => {
      clearInterval(id);
      void tracker.stop();
      naiveRef.current.last = null;
    };
  }, [playing, tracker]);

  const sleepMachine = () => {
    skewRef.current += 30 * 60 * 1000;
    add('💤 giả lập gập máy 30 phút rồi mở lại (đồng hồ nhảy 30 phút)', 'muted');
  };

  const fmt = (ms: number) => `${Math.floor(ms / 1000)}s`;

  return (
    <section className='card mc-section'>
      <h2>1. Đếm thời gian xem (Skillshare)</h2>
      <p className='hint'>
        Bấm Phát, chờ vài giây rồi bấm "Gập máy 30 phút". Cách ngây thơ cộng luôn 30 phút; tracker bỏ
        qua khoảng nào dài hơn 1s giữa hai lần timeupdate. Bật "Server lỗi" để thấy số giây được giữ lại.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => setPlaying((p) => !p)}>
          {playing ? '⏸ Tạm dừng' : '▶ Phát'}
        </button>
        <button onClick={sleepMachine} disabled={!playing}>
          💤 Gập máy 30 phút
        </button>
        <label className='switch'>
          <input type='checkbox' onChange={(e) => (serverDownRef.current = e.target.checked)} />
          Server lỗi
        </label>
      </div>
      <div className='stats'>
        <Stat label='Cách ngây thơ' value={fmt(naiveRef.current.total)} />
        <Stat label='Tracker: đã gửi' value={`${sentRef.current}s`} />
        <Stat label='Tracker: chờ gửi' value={fmt(tracker.getPendingMs())} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phần 2: timeline chủ + sửa lệch
// ---------------------------------------------------------------------------

/** "File nhạc" giả: chạy nhanh hơn 6% (lệch dần) và có thể bị đứng (giả lập buffer). */
class FakeAudio implements SyncTarget {
  private t = 0;
  private playing = false;
  private last = performance.now();
  private stallUntil = 0;
  constructor(private rate = 1.06) {}
  private advance() {
    const n = performance.now();
    if (this.playing) {
      const from = Math.max(this.last, this.stallUntil);
      if (n > from) this.t += (n - from) * this.rate;
    }
    this.last = n;
  }
  currentTime() {
    this.advance();
    return this.t;
  }
  seek(ms: number) {
    this.advance();
    this.t = ms;
  }
  play() {
    this.advance();
    this.playing = true;
  }
  pause() {
    this.advance();
    this.playing = false;
  }
  stall(ms: number) {
    this.advance();
    this.stallUntil = performance.now() + ms;
  }
}

const DURATION = 12_000;
const AUDIO = { offset: 2000, duration: 8000, start: 1000 };

function MasterTimeline() {
  const { lines, add } = useLog(30);
  const barRef = useRef<HTMLDivElement>(null);
  const [syncOn, setSyncOn] = useState(true);
  const [state, setState] = useState({ t: 0, audio: -1, drift: 0, fixes: 0 });
  const fixesRef = useRef(0);
  const audio = useMemo(() => new FakeAudio(), []);
  const [clock, setClock] = useState<ReturnType<typeof createMasterClock> | null>(null);

  // tạo lại clock mỗi khi bật/tắt sửa lệch (đơn giản cho demo)
  useEffect(() => {
    const bar = barRef.current!;
    const animation = bar.animate([{ left: '0%' }, { left: 'calc(100% - 14px)' }], {
      duration: DURATION,
      fill: 'both',
      easing: 'linear',
    });
    animation.pause();
    const master = createMasterClock({
      duration: DURATION,
      maxDrift: syncOn ? 250 : Infinity,
      tracks: [
        { id: 'animation', target: animationTarget(animation), offset: 0, duration: DURATION },
        { id: 'audio', target: audio, ...AUDIO },
      ],
      onCorrect: (id, drift) => {
        fixesRef.current++;
        add(`🔧 ${id} lệch ${Math.round(drift)}ms > 250ms → seek lại`, 'warn');
      },
      onFrame: (t) => {
        const inside = t >= AUDIO.offset && t < AUDIO.offset + AUDIO.duration;
        const actual = audio.currentTime();
        setState({
          t,
          audio: inside ? actual : -1,
          drift: inside ? actual - (t - AUDIO.offset + AUDIO.start) : 0,
          fixes: fixesRef.current,
        });
      },
      onEnd: () => add('⏹ hết timeline, quay về 0', 'muted'),
    });
    master.seek(0);
    setClock(master);
    return () => {
      master.destroy();
      animation.cancel();
      audio.pause();
    };
  }, [syncOn, audio, add]);

  const playing = clock?.isPlaying() ?? false;
  const toggle = () => {
    if (!clock) return;
    if (playing) clock.pause();
    else clock.play();
    setState((s) => ({ ...s }));
  };

  const pct = (ms: number) => `${(ms / DURATION) * 100}%`;

  return (
    <section className='card mc-section'>
      <h2>2. Timeline chủ + sửa lệch (Simplified)</h2>
      <p className='hint'>
        Timeline 12s gồm một animation và một đoạn nhạc (từ giây 2 tới 10, cắt 1s đầu file). "Nhạc" chạy
        nhanh hơn 6% nên lệch dần. Bật sửa lệch: mỗi khi lệch quá 250ms thì seek lại. Bấm "Nhạc bị đứng"
        để giả lập buffer.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={toggle}>
          {playing ? '⏸ Tạm dừng' : '▶ Phát'}
        </button>
        <button onClick={() => clock?.seek(clock.time() + 3000)}>⏩ +3s</button>
        <button
          onClick={() => {
            audio.stall(600);
            add('📶 nhạc đứng 600ms (giả lập buffer)', 'muted');
          }}
        >
          📶 Nhạc bị đứng
        </button>
        <label className='switch'>
          <input
            type='checkbox'
            checked={syncOn}
            onChange={(e) => {
              clock?.pause();
              setSyncOn(e.target.checked);
              fixesRef.current = 0;
            }}
          />
          Sửa lệch (250ms)
        </label>
      </div>
      <div className='mc-timeline'>
        <div className='mc-row'>
          <span>Chủ</span>
          <div className='mc-lane'>
            <div className='mc-head' style={{ left: pct(state.t) }} />
          </div>
        </div>
        <div className='mc-row'>
          <span>Anim</span>
          <div className='mc-lane mc-anim-lane'>
            <div ref={barRef} className='mc-anim' />
          </div>
        </div>
        <div className='mc-row'>
          <span>Nhạc</span>
          <div className='mc-lane'>
            <div
              className='mc-clip'
              style={{ left: pct(AUDIO.offset), width: pct(AUDIO.duration) }}
            />
            {state.audio >= 0 && (
              <div
                className='mc-head mc-audio-head'
                style={{ left: pct(state.audio - AUDIO.start + AUDIO.offset) }}
              />
            )}
          </div>
        </div>
      </div>
      <div className='stats'>
        <Stat label='Timeline chủ' value={`${(state.t / 1000).toFixed(2)}s`} />
        <Stat
          label='Nhạc lệch'
          value={
            <strong className={Math.abs(state.drift) > 250 ? 'err' : 'ok'}>
              {Math.round(state.drift)}ms
            </strong>
          }
        />
        <Stat label='Số lần seek sửa' value={state.fixes} />
      </div>
      <Log lines={lines} />
    </section>
  );
}

export default function MediaClockDemo() {
  return (
    <div className='page'>
      <h1>Đồng hồ media</h1>
      <WatchTime />
      <MasterTimeline />
    </div>
  );
}

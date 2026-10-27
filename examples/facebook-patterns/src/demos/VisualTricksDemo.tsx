import { useEffect, useRef, useState } from 'react';
import { Glimmer } from '../lib/glimmer';
import { Facepile, getBadgeOffset, getBadgeSizeAndGap, MaskedAvatar } from '../lib/maskedAvatar';
import { Stat } from './shared';
import './VisualTricksDemo.css';

// Ảnh đại diện giả: SVG gradient + chữ cái đầu, encode thành data URL (không cần mạng).
function fakeAvatar(letter: string, from: string, to: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>
    <rect width="96" height="96" fill="url(#g)"/>
    <text x="48" y="62" font-family="system-ui,sans-serif" font-size="42" font-weight="700"
      fill="white" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const AVATARS = [
  fakeAvatar('H', '#ff9a3c', '#f2466b'),
  fakeAvatar('L', '#3b82f6', '#06b6d4'),
  fakeAvatar('M', '#a855f7', '#ec4899'),
  fakeAvatar('T', '#10b981', '#84cc16'),
  fakeAvatar('N', '#f59e0b', '#ef4444'),
];

type Bg = 'white' | 'dark' | 'photo';

/** Cách "ngây thơ": chấm xanh có viền trắng 2px. Đẹp trên nền trắng, lộ trên mọi nền khác. */
function NaiveAvatar({ src, size }: { src: string; size: number }) {
  const [dot] = getBadgeSizeAndGap(size);
  const offset = getBadgeOffset(size / 2);
  return (
    <span className='vt-naive' style={{ width: size, height: size }}>
      <img src={src} width={size} height={size} alt='' />
      <span
        className='vt-naive-dot'
        style={{ width: dot, height: dot, right: offset, bottom: offset, transform: 'translate(50%, 50%)' }}
      />
    </span>
  );
}

const MESSAGES = Array.from({ length: 40 }, (_, i) => ({
  mine: i % 3 !== 0,
  text: i % 3 === 0 ? `Tin nhắn của bạn bè #${i + 1}` : `Tin nhắn của mình #${i + 1} ${'— gradient '.repeat(i % 2)}`,
}));

/** Đếm số lần opacity thực sự đổi trong 1 giây của một glimmer (đo bằng rAF + getComputedStyle). */
function useOpacityChangesPerSecond(target: HTMLElement | null) {
  const [rate, setRate] = useState(0);
  useEffect(() => {
    if (!target) return;
    let frame = 0;
    let last = '';
    let changes = 0;
    let windowStart = performance.now();
    const tick = (now: number) => {
      const opacity = getComputedStyle(target).opacity;
      if (opacity !== last) changes++;
      last = opacity;
      if (now - windowStart >= 1000) {
        setRate(changes);
        changes = 0;
        windowStart = now;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return rate;
}

export default function VisualTricksDemo() {
  const [bg, setBg] = useState<Bg>('photo');
  const [attachment, setAttachment] = useState<'fixed' | 'scroll'>('fixed');
  const [smooth, setSmooth] = useState(false);
  const [probe, setProbe] = useState<HTMLElement | null>(null);
  const [running, setRunning] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const changes = useOpacityChangesPerSecond((probe?.firstElementChild as HTMLElement | null) ?? null);

  // đếm số glimmer đang chạy animation (không bị pause vì nằm ngoài viewport)
  useEffect(() => {
    const id = setInterval(() => {
      setRunning(listRef.current?.querySelectorAll('.glimmer[data-paused="false"]').length ?? 0);
    }, 300);
    return () => clearInterval(id);
  }, []);

  return (
    <div className='page'>
      <h1>Mẹo hình ảnh của Facebook</h1>
      <p className='hint'>Avatar khoét bằng SVG mask, bong bóng chat gradient, skeleton tiết kiệm CPU.</p>

      <section className='vt-section'>
        <h2>1. Avatar khoét rãnh vs viền trắng</h2>
        <div className='toolbar'>
          {(['white', 'dark', 'photo'] as const).map((value) => (
            <button key={value} className={bg === value ? 'primary' : undefined} onClick={() => setBg(value)}>
              Nền {value === 'white' ? 'trắng' : value === 'dark' ? 'tối' : 'ảnh'}
            </button>
          ))}
        </div>
        <div className='vt-stage' data-bg={bg} data-testid='avatar-stage'>
          <div className='vt-col'>
            <h3>SVG mask (Facebook)</h3>
            <div className='vt-row'>
              <MaskedAvatar src={AVATARS[0]} size={40} online alt='Hưng' />
              <MaskedAvatar src={AVATARS[1]} size={60} online alt='Linh' />
              <MaskedAvatar src={AVATARS[2]} size={96} online alt='Mai' />
            </div>
            <div className='vt-row'>
              <MaskedAvatar src={AVATARS[3]} size={60} count={3} alt='Tú' />
              <MaskedAvatar src={AVATARS[4]} size={60} count={27} alt='Nam' />
              <Facepile sources={AVATARS} size={32} />
            </div>
          </div>
          <div className='vt-col'>
            <h3>Viền trắng (cách thường gặp)</h3>
            <div className='vt-row'>
              <NaiveAvatar src={AVATARS[0]} size={40} />
              <NaiveAvatar src={AVATARS[1]} size={60} />
              <NaiveAvatar src={AVATARS[2]} size={96} />
            </div>
          </div>
        </div>
      </section>

      <section className='vt-section'>
        <h2>2. Bong bóng chat gradient (Messenger)</h2>
        <div className='toolbar'>
          <label className='switch'>
            <input
              type='checkbox'
              checked={attachment === 'fixed'}
              onChange={(e) => setAttachment(e.target.checked ? 'fixed' : 'scroll')}
            />
            background-attachment: fixed
          </label>
          <span className='muted'>Cuộn khung chat: màu bong bóng đổi theo vị trí trên màn hình.</span>
        </div>
        <div className='vt-chat' data-attachment={attachment} data-testid='chat'>
          {MESSAGES.map((m, i) => (
            <div key={i} className={`vt-bubble ${m.mine ? 'mine' : 'theirs'}`}>
              {m.text}
            </div>
          ))}
        </div>
      </section>

      <section className='vt-section'>
        <h2>3. Skeleton glimmer: steps(10) + tạm dừng khi khuất</h2>
        <div className='toolbar'>
          <label className='switch'>
            <input type='checkbox' checked={smooth} onChange={(e) => setSmooth(e.target.checked)} />
            Nội suy mượt (để so sánh)
          </label>
        </div>
        <div className='stats'>
          <Stat label='lần đổi opacity / giây (khối đầu)' value={changes} />
          <Stat label='khối glimmer đang chạy / 90' value={running} />
        </div>
        <div className='vt-glimmer-list' ref={listRef} data-testid='glimmer-list'>
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} className='vt-glimmer-row'>
              <Glimmer index={i} smooth={smooth} style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <Glimmer index={i} smooth={smooth} style={{ height: 12, width: '60%', marginBottom: 8 }} />
                <Glimmer index={i} smooth={smooth} style={{ height: 12, width: '85%' }} />
              </div>
            </div>
          ))}
        </div>
        {/* khối đo: luôn hiển thị, đặt ngoài list để đếm số lần đổi opacity */}
        <div ref={setProbe} style={{ marginTop: 8 }}>
          <Glimmer smooth={smooth} style={{ height: 8, width: 120 }} />
        </div>
      </section>
    </div>
  );
}

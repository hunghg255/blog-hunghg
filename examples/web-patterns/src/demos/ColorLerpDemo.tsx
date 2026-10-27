import { useEffect, useRef, useState } from 'react';
import { Stat } from './shared';
import {
  createThemeAnimator,
  mixOklab,
  mixSrgb,
  toCss,
  trackScrollColor,
  type Palette,
  type Rgba,
  type ThemeAnimator,
} from '../lib/colorLerp';
import './ColorLerpDemo.css';

const LIGHT: Palette = {
  '--c-bg': '#ffffff',
  '--c-surface': '#f1f1f4',
  '--c-text': '#111116',
  '--c-muted': '#707579',
  '--c-bubble': '#ffffff',
  '--c-bubble-out': '#e3fee0',
  '--c-accent': '#3390ec',
  '--c-border': '#dadce0',
};
const DARK: Palette = {
  '--c-bg': '#181818',
  '--c-surface': '#212121',
  '--c-text': '#ffffff',
  '--c-muted': '#aaaaaa',
  '--c-bubble': '#2c2c2e',
  '--c-bubble-out': '#8774e1',
  '--c-accent': '#8774e1',
  '--c-border': '#303030',
};

type Mode = 'jump' | 'transition' | 'property' | 'srgb' | 'oklab';
const MODES: Array<[Mode, string]> = [
  ['jump', 'Nhảy ngay'],
  ['transition', 'CSS transition từng thuộc tính'],
  ['property', '@property + transition biến'],
  ['srgb', 'Lerp JS, sRGB (Telegram)'],
  ['oklab', 'Lerp JS, OKLab'],
];

const parseRgb = (value: string) => value.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [0, 0, 0];

function ThemePart() {
  const panelRef = useRef<HTMLDivElement>(null);
  const animatorRef = useRef<ThemeAnimator | null>(null);
  const [mode, setMode] = useState<Mode>('srgb');
  const [restartFromEnd, setRestartFromEnd] = useState(false);
  const [dark, setDark] = useState(false);
  const [stats, setStats] = useState({ frames: 0, maxJump: 0 });
  const darkRef = useRef(false);
  const prevBg = useRef<number[] | null>(null);
  const counters = useRef({ frames: 0, maxJump: 0 });

  // đo "bước nhảy" lớn nhất của --c-bg giữa hai frame liên tiếp (đơn vị: tổng |Δr|+|Δg|+|Δb|)
  const sample = () => {
    const panel = panelRef.current;
    if (!panel) return;
    const bg = parseRgb(getComputedStyle(panel).backgroundColor);
    if (prevBg.current) {
      const jump = bg.reduce((sum, v, i) => sum + Math.abs(v - prevBg.current![i]), 0);
      counters.current.maxJump = Math.max(counters.current.maxJump, Math.round(jump));
    }
    prevBg.current = bg;
    counters.current.frames++;
  };

  const makeAnimator = (initial: Palette) =>
    createThemeAnimator(panelRef.current!, initial, { mix: mode === 'oklab' ? mixOklab : mixSrgb });

  useEffect(() => {
    animatorRef.current?.cancel();
    animatorRef.current = makeAnimator(darkRef.current ? DARK : LIGHT);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // vòng rAF đo màu nền thật sự trên màn hình trong ~700ms sau mỗi lần đổi
  const measureFor = (ms: number) => {
    const until = performance.now() + ms;
    const loop = () => {
      sample();
      setStats({ ...counters.current });
      if (performance.now() < until) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };

  const toggle = () => {
    const next = !darkRef.current;
    darkRef.current = next;
    setDark(next);
    const target = next ? DARK : LIGHT;
    if (mode === 'srgb' || mode === 'oklab') {
      if (restartFromEnd) {
        // kiểu Telegram: luôn xuất phát từ palette đầu kia, bất kể đang hiện màu gì
        animatorRef.current?.cancel();
        animatorRef.current = makeAnimator(next ? LIGHT : DARK);
      }
      animatorRef.current!.switchTo(target);
    } else {
      animatorRef.current!.switchTo(target, { animate: false });
    }
  };

  const run = (times: number) => {
    counters.current = { frames: 0, maxJump: 0 };
    prevBg.current = null;
    for (let i = 0; i < times; i++) setTimeout(toggle, i * 70);
    measureFor(700 + times * 70);
  };

  return (
    <section className='card cl-part'>
      <h2>1. Đổi theme</h2>
      <div className='toolbar'>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label='Cách chuyển màu'>
          {MODES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className='switch'>
          <input
            type='checkbox'
            checked={restartFromEnd}
            onChange={(e) => setRestartFromEnd(e.target.checked)}
            disabled={mode !== 'srgb' && mode !== 'oklab'}
          />{' '}
          Bị ngắt thì chạy lại từ đầu (như Telegram)
        </label>
      </div>
      <div className='toolbar'>
        <button className='primary' onClick={() => run(1)}>
          Đổi theme
        </button>
        <button onClick={() => run(3)}>Bấm 3 lần liên tiếp (cách 70ms)</button>
      </div>
      <div className='stats'>
        <Stat label='theme đích' value={dark ? 'tối' : 'sáng'} />
        <Stat label='frame đã đo' value={stats.frames} />
        <Stat label='bước nhảy nền lớn nhất / frame' value={stats.maxJump} />
      </div>

      <div ref={panelRef} className={`cl-chat cl-${mode}`}>
        <div className='cl-head'>
          <svg viewBox='0 0 24 24' width='22' height='22' aria-hidden='true'>
            <circle cx='12' cy='12' r='11' />
          </svg>
          <b>Nhóm Frontend</b>
          <span>128 thành viên</span>
        </div>
        <div className='cl-msgs'>
          <p className='cl-in'>Mai deploy bản mới nhé 🚀</p>
          <p className='cl-out'>Ok, mình review PR tối nay</p>
          <p className='cl-in'>Nhớ bật dark mode thử luôn</p>
        </div>
        <div className='cl-input'>Nhắn tin…</div>
      </div>
      <p className='hint'>
        "CSS transition từng thuộc tính" chỉ khai báo transition cho nền và chữ: viền, icon SVG và bong bóng gradient vẫn nhảy.
      </p>
    </section>
  );
}

const SECTIONS = [
  { title: 'Mở đầu', color: '#2b2d42', height: 240 },
  { title: 'Section cao hơn khung (620px)', color: '#8d3b72', height: 620 },
  { title: 'Tính năng', color: '#1d6f6a', height: 280 },
  { title: 'Section rất cao (760px)', color: '#c2581b', height: 760 },
  { title: 'Kết', color: '#264653', height: 260 },
];

function ScrollPart() {
  const boxRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const [normalize, setNormalize] = useState(true);
  const [oklab, setOklab] = useState(false);
  const [info, setInfo] = useState({ index: 0, ratio: 1, color: SECTIONS[0].color, maxRatio: 0 });
  const maxRatio = useRef<Record<number, number>>({});

  useEffect(() => {
    const box = boxRef.current!;
    maxRatio.current = {};
    return trackScrollColor(
      sectionRefs.current.filter(Boolean) as HTMLDivElement[],
      SECTIONS.map((s) => s.color),
      (color: Rgba, { index, ratio }) => {
        box.style.backgroundColor = toCss(color);
        maxRatio.current[index] = Math.max(maxRatio.current[index] ?? 0, ratio);
        setInfo({ index, ratio, color: toCss(color), maxRatio: maxRatio.current[index] });
      },
      { root: box, normalize, mix: oklab ? mixOklab : mixSrgb },
    );
  }, [normalize, oklab]);

  return (
    <section className='card cl-part'>
      <h2>2. Nền đổi màu theo vị trí cuộn</h2>
      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={normalize} onChange={(e) => setNormalize(e.target.checked)} /> Chuẩn hoá tỉ lệ cho
          section cao
        </label>
        <label className='switch'>
          <input type='checkbox' checked={oklab} onChange={(e) => setOklab(e.target.checked)} /> Trộn trong OKLab
        </label>
      </div>
      <div className='stats'>
        <Stat label='section trên cùng' value={info.index + 1} />
        <Stat label='tỉ lệ dùng để trộn' value={info.ratio.toFixed(2)} />
        <Stat label='tỉ lệ lớn nhất đã đạt (section này)' value={info.maxRatio.toFixed(2)} />
      </div>
      <div ref={boxRef} className='cl-scroll' tabIndex={0} aria-label='Vùng cuộn đổi màu nền'>
        {SECTIONS.map((section, i) => (
          <div
            key={section.title}
            ref={(el) => {
              sectionRefs.current[i] = el;
            }}
            className='cl-section'
            style={{ height: section.height }}
          >
            <span className='cl-label'>
              <span className='cl-swatch' style={{ background: section.color }} />
              {i + 1}. {section.title}
            </span>
          </div>
        ))}
      </div>
      <p className='hint'>
        Tắt chuẩn hoá rồi cuộn vào section 2 hoặc 4: tỉ lệ không bao giờ lên tới 1, nên nền không bao giờ đúng màu của section đó.
      </p>
    </section>
  );
}

export default function ColorLerpDemo() {
  return (
    <div className='page color-lerp-demo'>
      <h1>Nội suy màu: đổi theme và nền theo cuộn</h1>
      <p className='hint'>So sánh các cách chuyển màu (Telegram) và trộn màu theo vị trí cuộn (Anchor).</p>
      <ThemePart />
      <ScrollPart />
    </div>
  );
}

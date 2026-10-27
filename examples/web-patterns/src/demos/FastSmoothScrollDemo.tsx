import { useEffect, useRef, useState } from 'react';
import { fastSmoothScroll } from '../lib/fastSmoothScroll';
import { Log, Stat, useLog } from './shared';
import './FastSmoothScrollDemo.css';

const COUNT = 3000;
const NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Hà', 'Khoa', 'Linh', 'Minh'];
const TEXTS = ['Ok nhé', 'Mai họp lúc 9h', 'Gửi file rồi đó', 'Haha 😂', 'Để mình xem lại', 'Đã fix bug', 'Ship thôi!'];

type Mode = 'fast' | 'native' | 'full';
const MODE_LABEL: Record<Mode, string> = {
  fast: 'fastSmoothScroll (Telegram)',
  native: 'scrollTo({ behavior: "smooth" })',
  full: 'JS animate toàn bộ quãng đường',
};

/** Cách "ngây thơ": animate cả quãng đường, cùng easing, 600ms. */
function animateFull(container: HTMLElement, target: number) {
  const from = container.scrollTop;
  const path = target - from;
  let start: number | undefined;
  const tick = (now: number) => {
    start ??= now;
    const t = Math.min((now - start) / 600, 1);
    container.scrollTop = Math.round(from + path * (1 - (1 - t) ** 5));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Đo: thời gian tới khi scrollTop đứng yên, số frame, tổng px đã cuộn và bước lớn nhất trong một frame. */
function measure(
  container: HTMLElement,
  onDone: (r: { ms: number; frames: number; total: number; maxStep: number }) => void,
) {
  const t0 = performance.now();
  let last = container.scrollTop;
  let lastMove = t0;
  let total = 0;
  let maxStep = 0;
  let frames = 0;
  let still = 0;
  const sample = (now: number) => {
    const delta = Math.abs(container.scrollTop - last);
    last = container.scrollTop;
    total += delta;
    maxStep = Math.max(maxStep, delta);
    if (delta > 0) {
      frames++;
      still = 0;
      lastMove = now;
    } else still++;
    // đứng yên 10 frame liên tiếp = đã xong
    if (still < 10) requestAnimationFrame(sample);
    else onDone({ ms: frames ? Math.round(lastMove - t0) : 0, frames, total: Math.round(total), maxStep: Math.round(maxStep) });
  };
  requestAnimationFrame(sample);
}

export default function FastSmoothScrollDemo() {
  const listRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('fast');
  const [result, setResult] = useState<{ ms: number; frames: number; total: number; maxStep: number; teleported: number } | null>(null);
  const { lines, add } = useLog();

  useEffect(() => {
    const list = listRef.current!;
    list.scrollTop = list.scrollHeight; // mở chat ở tin mới nhất
  }, []);

  function goTo(index: number) {
    const list = listRef.current!;
    const el = list.querySelector<HTMLElement>(`[data-index="${index}"]`)!;
    const from = list.scrollTop;
    let teleported = 0;
    if (mode === 'fast') {
      teleported = fastSmoothScroll(list, el, { position: 'center', abortOnUserInput: true }).teleported;
    } else {
      // offsetTop tính theo offsetParent (ở đây là body), nên đo bằng getBoundingClientRect
      const elTop = el.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientTop + list.scrollTop;
      const top = elTop - list.clientHeight / 2 + el.offsetHeight / 2;
      const target = Math.max(0, Math.min(top, list.scrollHeight - list.clientHeight));
      if (mode === 'native') list.scrollTo({ top: target, behavior: 'smooth' });
      else animateFull(list, target);
    }
    el.classList.remove('fs2-flash');
    void el.offsetWidth; // khởi động lại animation highlight
    el.classList.add('fs2-flash');
    measure(list, (r) => {
      setResult({ ...r, teleported: Math.round(teleported) });
      add(
        `${MODE_LABEL[mode]} → tin #${index + 1} (cách ${Math.round(Math.abs(list.scrollTop - from))}px): ${r.ms}ms, ` +
          `${r.frames} frame, tối đa ${r.maxStep}px/frame` + (teleported ? `, nhảy tức thời ${Math.round(teleported)}px` : ''),
        r.ms <= 650 && r.maxStep <= list.clientHeight ? 'ok' : 'warn',
      );
    });
  }

  const jumpTargets: Array<[string, number]> = [
    ['Tin đầu tiên', 0],
    ['Tin #1500', 1499],
    ['Tin mới nhất', COUNT - 1],
    ['Gần: lên 6 tin', -6],
  ];

  return (
    <div className='page'>
      <h1>fastSmoothScroll</h1>
      <p className='hint'>
        Chat có {COUNT.toLocaleString('vi-VN')} tin (~{Math.round((COUNT * 52) / 1000)}.000px). Chọn cách cuộn rồi bấm nhảy tới
        một tin. Cách của Telegram luôn xong trong 250–600ms và mỗi frame chỉ dịch vài trăm px, mắt vẫn theo được hướng cuộn.
      </p>
      <div className='toolbar'>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label='Cách cuộn'>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
            <option key={m} value={m}>
              {MODE_LABEL[m]}
            </option>
          ))}
        </select>
        {jumpTargets.map(([label, index]) => (
          <button
            key={label}
            className={index === 1499 ? 'primary' : undefined}
            onClick={() => {
              if (index >= 0) return goTo(index);
              // "gần": tính theo tin đang ở giữa khung nhìn
              const list = listRef.current!;
              const middle = Math.floor((list.scrollTop + list.clientHeight / 2) / 52);
              goTo(Math.max(0, middle + index));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className='stats'>
        <Stat label='thời gian' value={result ? `${result.ms}ms` : '–'} />
        <Stat label='số frame cuộn' value={result?.frames ?? '–'} />
        <Stat label='px/frame lớn nhất' value={result ? result.maxStep.toLocaleString('vi-VN') : '–'} />
        <Stat label='px nhảy tức thời' value={result ? result.teleported.toLocaleString('vi-VN') : '–'} />
      </div>
      <div className='fs2-list' ref={listRef} tabIndex={0}>
        {Array.from({ length: COUNT }, (_, i) => (
          <div key={i} className={`fs2-row ${i % 3 === 0 ? 'me' : ''}`} data-index={i}>
            <span className='fs2-avatar'>{NAMES[i % NAMES.length][0]}</span>
            <span className='fs2-bubble'>
              <b>#{i + 1}</b> {TEXTS[(Math.imul(i, 2654435761) >>> 0) % TEXTS.length]}
            </span>
          </div>
        ))}
      </div>
      <Log lines={lines} />
    </div>
  );
}

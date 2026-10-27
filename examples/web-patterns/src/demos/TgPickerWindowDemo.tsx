import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  categoryBodyHeight,
  centeredHeaderScroll,
  createBooleanFreezer,
  createFreezer,
  itemsPerRow,
  pickActiveCategory,
  shouldRenderCategory,
  type Freezable,
} from '../lib/tgPickerWindow';
import { Stat } from './shared';
import './TgPickerWindowDemo.css';

const RANGES: [string, string, number, number][] = [
  ['😀', 'Mặt cười', 0x1f600, 0x1f64f],
  ['🐶', 'Động vật', 0x1f400, 0x1f43f],
  ['🍔', 'Đồ ăn', 0x1f340, 0x1f37f],
  ['⚽', 'Hoạt động', 0x1f380, 0x1f3ff],
  ['🚗', 'Du lịch', 0x1f680, 0x1f6c5],
  ['💡', 'Đồ vật', 0x1f4a0, 0x1f4ff],
  ['🔣', 'Ký hiệu', 0x1f500, 0x1f53d],
  ['🤖', 'Bổ sung', 0x1f910, 0x1f9ff],
];
const REPEAT = 3; // nhân dữ liệu lên ~3.000 emoji cho giống bảng thật

const CATEGORIES = RANGES.map(([icon, name, from, to]) => {
  const base = Array.from({ length: to - from + 1 }, (_, i) => String.fromCodePoint(from + i));
  return { icon, name, emojis: Array.from({ length: REPEAT }, () => base).flat() };
});
const TOTAL = CATEGORIES.reduce((n, c) => n + c.emojis.length, 0);

export default function TgPickerWindowDemo() {
  return (
    <div className='page tg-picker'>
      <h1>Telegram #17: bảng emoji chỉ render nhóm đang xem</h1>
      <Picker />
      <FreezeDemo />
    </div>
  );
}

function Picker() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [windowed, setWindowed] = useState(true);
  const [active, setActive] = useState(0);
  const [width, setWidth] = useState(360);
  const [nodes, setNodes] = useState(0);
  const [renderMs, setRenderMs] = useState(0);
  const renderStart = useRef(performance.now());
  renderStart.current = performance.now();

  const isMobile = width < 420;
  const perRow = itemsPerRow(width, isMobile);

  // đo sau khi commit: thời gian từ lúc render bắt đầu tới khi DOM xong, và số node trong bảng
  useLayoutEffect(() => {
    setRenderMs(performance.now() - renderStart.current);
    setNodes(scrollRef.current!.getElementsByTagName('*').length);
  }, [windowed, active, perRow]);

  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Scroll-spy: IO + throttle 200ms, chọn nhóm GIỮA trong các nhóm đang giao
  useEffect(() => {
    const root = scrollRef.current!;
    const state = new Map<number, boolean>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => state.set(Number((e.target as HTMLElement).dataset.index), e.isIntersecting));
        if (timer) return;
        timer = setTimeout(() => {
          timer = undefined;
          const next = pickActiveCategory(state);
          if (next !== undefined) setActive(next);
        }, 200);
      },
      { root },
    );
    root.querySelectorAll<HTMLElement>('[data-index]').forEach((el) => io.observe(el));
    return () => {
      io.disconnect();
      clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const header = headerRef.current!;
    header.scrollTo({ left: centeredHeaderScroll(active, header.clientWidth), behavior: 'smooth' });
  }, [active]);

  const jump = (i: number) => {
    setActive(i);
    const el = scrollRef.current!.querySelector<HTMLElement>(`[data-index="${i}"]`)!;
    scrollRef.current!.scrollTo({ top: el.offsetTop - 4 });
  };

  return (
    <>
      <p className='hint'>
        {TOTAL.toLocaleString('vi-VN')} emoji chia {CATEGORIES.length} nhóm. Chiều cao mỗi nhóm tính trước bằng{' '}
        <code>ceil(n / {perRow}) × 44</code>, nên thanh cuộn đúng ngay cả khi nhóm chưa render. Cuộn và xem số node DOM.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={windowed} onChange={(e) => setWindowed(e.target.checked)} /> Chỉ render nhóm đang xem ±1
        </label>
      </div>
      <div className='stats'>
        <Stat label='node DOM trong bảng' value={nodes.toLocaleString('vi-VN')} />
        <Stat label='lần render gần nhất' value={`${renderMs.toFixed(1)}ms`} />
        <Stat label='nhóm đang xem' value={CATEGORIES[active].name} />
      </div>
      <div className='card tgp-picker'>
        <div className='tgp-header' ref={headerRef} role='tablist' aria-label='Nhóm emoji'>
          {CATEGORIES.map((c, i) => (
            <button key={c.name} role='tab' aria-selected={i === active} title={c.name} className={i === active ? 'active' : ''} onClick={() => jump(i)}>
              {c.icon}
            </button>
          ))}
        </div>
        <div className='tgp-scroll' ref={scrollRef}>
          {CATEGORIES.map((c, i) => {
            const render = !windowed || shouldRenderCategory(active, i);
            return (
              <section key={c.name} data-index={i} className='tgp-cat'>
                <h3>{c.name}</h3>
                <div
                  className={`tgp-grid ${render ? 'shown' : ''}`}
                  style={{ height: categoryBodyHeight(c.emojis.length, perRow), gridTemplateColumns: `repeat(${perRow}, 40px)` }}
                >
                  {render && c.emojis.map((e, k) => <button key={k} className='tgp-emoji' aria-label={e}>{e}</button>)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}

// ---------- Đóng băng animation ----------

const STICKERS = 12;

function FreezeDemo() {
  const gridRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'counter' | 'boolean'>('boolean');
  const [modal, setModal] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [playing, setPlaying] = useState(STICKERS);

  const animations = useRef<Animation[]>([]);
  useEffect(() => {
    animations.current = Array.from(gridRef.current!.children).map((el, i) =>
      el.animate(
        [{ transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(15deg) scale(1.15)' }, { transform: 'rotate(0deg) scale(1)' }],
        { duration: 900 + i * 40, iterations: Infinity },
      ),
    );
    return () => animations.current.forEach((a) => a.cancel());
  }, []);

  const freezers = useRef<ReturnType<typeof createFreezer>[]>([]);
  // chạy SAU effect tạo animation (effect chạy theo thứ tự khai báo); đổi chế độ thì tạo lại
  useEffect(() => {
    animations.current.forEach((a) => a.play());
    freezers.current = animations.current.map((a) => {
      const target: Freezable = {
        isPlaying: () => a.playState === 'running',
        play: () => a.play(),
        pause: () => a.pause(),
      };
      return mode === 'counter' ? createFreezer(target) : createBooleanFreezer(target);
    });
  }, [mode]);

  const refresh = () => setPlaying(animations.current.filter((a) => a.playState === 'running').length);

  const toggle = (reason: 'modal' | 'hidden', on: boolean) => {
    freezers.current.forEach((f) => (on ? f.freeze(reason) : f.unfreeze(reason)));
    (reason === 'modal' ? setModal : setHidden)(on);
    refresh();
  };

  // tab ẩn thật cũng đóng băng
  useEffect(() => {
    const onVis = () => toggle('hidden', document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  });

  const reset = (next: 'counter' | 'boolean') => {
    setModal(false);
    setHidden(false);
    setMode(next);
    requestAnimationFrame(refresh);
  };

  return (
    <>
      <h2>Đóng băng sticker khi có nhiều nguồn cùng yêu cầu dừng</h2>
      <p className='hint'>
        Bật <b>Mở modal</b> rồi <b>Giả lập tab ẩn</b>, sau đó tắt <b>Mở modal</b>. Modal đã đóng nhưng tab vẫn đang ẩn, nên
        sticker phải đứng yên. Với một cờ boolean như bản gốc, chúng chạy lại ngay.
      </p>
      <div className='toolbar'>
        <button className={mode === 'boolean' ? 'primary' : ''} onClick={() => reset('boolean')}>
          1 cờ boolean (bản gốc)
        </button>
        <button className={mode === 'counter' ? 'primary' : ''} onClick={() => reset('counter')}>
          Đếm theo nguồn
        </button>
        <label>
          <input type='checkbox' checked={modal} onChange={(e) => toggle('modal', e.target.checked)} /> Mở modal
        </label>
        <label>
          <input type='checkbox' checked={hidden} onChange={(e) => toggle('hidden', e.target.checked)} /> Giả lập tab ẩn
        </label>
      </div>
      <div className='stats'>
        <Stat label='sticker đang chạy' value={`${playing}/${STICKERS}`} />
        <Stat
          label='trạng thái mong đợi'
          value={modal || hidden ? <span className={playing ? 'err' : 'ok'}>{playing ? 'lẽ ra phải dừng' : 'đang dừng ✓'}</span> : 'chạy'}
        />
      </div>
      <div className='tgp-stickers' ref={gridRef}>
        {Array.from({ length: STICKERS }, (_, i) => (
          <span key={i} className='tgp-sticker' aria-hidden>
            {['🐱', '🦊', '🐸', '🐵', '🐼', '🐧'][i % 6]}
          </span>
        ))}
      </div>
    </>
  );
}

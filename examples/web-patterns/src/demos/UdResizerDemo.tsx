import { useEffect, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import { attachResizer, fadeMask, watchFade, type FadeState } from '../lib/udResizer';
import { attachUdemyStyleResizer } from './UdResizerUdemyStyle';
import './UdResizerDemo.css';

// ---------------------------------------------------------------- 1. kéo mép trái

type Mode = 'udemy' | 'rewrite';
type Anchor = 'right' | 'left';

function ResizeSection() {
  const [mode, setMode] = useState<Mode>('rewrite');
  const [anchor, setAnchor] = useState<Anchor>('right');
  const [width, setWidth] = useState(260);
  const [selected, setSelected] = useState('');
  const panelRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<{ x: number; w: number } | null>(null);
  const log = useLog(8);

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const apply = (w: number) => {
      const clamped = Math.max(120, Math.min(w, 2000));
      el.style.width = `${clamped}px`; // ghi thẳng DOM như store của Udemy, React đọc lại sau
      setWidth(Math.round(clamped));
    };
    // ghi lại điểm bắt đầu để báo cáo "đúng ra phải rộng bao nhiêu"
    const onDown = (e: PointerEvent | MouseEvent) => {
      startRef.current = { x: e.clientX, w: el.getBoundingClientRect().width };
    };
    const onUp = (e: PointerEvent | MouseEvent) => {
      const s = startRef.current;
      startRef.current = null;
      if (!s) return;
      const got = Math.round(el.getBoundingClientRect().width);
      const expected = Math.round(Math.max(120, s.w - (e.clientX - s.x)));
      if (Math.abs(got - s.w) < 1) return; // chỉ là click, không kéo
      const ok = Math.abs(got - expected) <= 2;
      log.add(
        `kéo ${Math.round(s.x - e.clientX)}px → rộng ${Math.round(s.w)} → ${got}px (đúng ra ${expected}px)`,
        ok ? 'ok' : 'err',
      );
    };
    el.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);

    const detach =
      mode === 'udemy'
        ? attachUdemyStyleResizer(el, { left: true }, (size) => apply(size.width))
        : attachResizer(el, { edges: { left: true }, minWidth: 120, onMove: (size) => apply(size.width) });
    return () => {
      detach();
      el.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
    };
  }, [mode, log.add]);

  useEffect(() => {
    const onSel = () => {
      const sel = document.getSelection();
      const inside = sel && panelRef.current && sel.anchorNode && panelRef.current.contains(sel.anchorNode);
      setSelected(inside ? sel.toString() : '');
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const reset = () => {
    if (panelRef.current) panelRef.current.style.width = '260px';
    setWidth(260);
    log.clear();
  };

  return (
    <section className='card ud-rs'>
      <h2>1. Kéo mép trái của khung xem trước</h2>
      <p className='hint'>
        Kéo thanh dọc bên trái khung tím. Khung neo bên phải (như IDE của Udemy) thì hai cách giống nhau. Đổi sang{' '}
        <b>neo bên trái</b> rồi kéo: cách đọc lại kích thước ở mỗi lần di chuột cứ cộng dồn. Thử bôi đen chữ trong
        khung ở cả hai chế độ.
      </p>
      <div className='toolbar' role='group' aria-label='Chế độ'>
        <button className={mode === 'udemy' ? 'primary' : ''} aria-pressed={mode === 'udemy'} onClick={() => setMode('udemy')}>
          Kiểu Udemy
        </button>
        <button className={mode === 'rewrite' ? 'primary' : ''} aria-pressed={mode === 'rewrite'} onClick={() => setMode('rewrite')}>
          Viết lại
        </button>
        <button aria-pressed={anchor === 'left'} onClick={() => setAnchor(anchor === 'right' ? 'left' : 'right')}>
          Khung neo: {anchor === 'right' ? 'bên phải' : 'bên trái'}
        </button>
        <button onClick={reset}>Đặt lại</button>
      </div>
      <div className='stats'>
        <Stat label='Bề rộng khung (px)' value={<bdi data-testid='rs-width'>{width}</bdi>} />
        <Stat label='Chữ đang bôi đen' value={<bdi data-testid='rs-selected'>{selected ? `${selected.length} ký tự` : '—'}</bdi>} />
      </div>
      <div className={`ud-rs-stage ud-rs-anchor-${anchor}`}>
        <div className='ud-rs-editor muted'>editor.js</div>
        <div ref={panelRef} className='ud-rs-panel' data-testid='rs-panel' style={{ width: 260 }}>
          <div className='ud-rs-handle' aria-hidden='true' />
          <p className='ud-rs-text' data-testid='rs-text'>
            Bôi đen đoạn này để thử. Kiểu Udemy gọi preventDefault ở mousedown trên cả khung nên trình duyệt không
            bắt đầu vùng chọn.
          </p>
        </div>
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

// ---------------------------------------------------------------- 2. mép cuộn mờ dần

const TOPICS = [
  'JavaScript', 'Python', 'React', 'SQL', 'Docker', 'Excel', 'Figma', 'AWS',
  'Kubernetes', 'TypeScript', 'Go', 'Machine Learning', 'Power BI', 'Photoshop',
];

/** Mô phỏng logic GradientScroll bản gốc: trạng thái ban đầu 'left', chỉ cập nhật khi cuộn. */
function UdemyStyleRow({ items, rtl }: { items: string[]; rtl: boolean }) {
  const [anchor, setAnchor] = useState<'left' | 'right' | undefined>('left');
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollLeft, scrollWidth, offsetWidth } = e.currentTarget;
    if (scrollLeft <= 10) setAnchor('left');
    else if (scrollLeft >= scrollWidth - offsetWidth - 10) setAnchor('right');
    else if (anchor) setAnchor(undefined);
  };
  return (
    <div className='ud-gs-container' data-testid='gs-udemy'>
      <div className='ud-gs-row' dir={rtl ? 'rtl' : 'ltr'} onScroll={onScroll}>
        <div className='ud-gs-track'>
          {items.map((t) => (
            <span key={t} className='ud-gs-chip'>{t}</span>
          ))}
        </div>
      </div>
      {anchor !== 'right' && <div className='ud-gs-overlay ud-gs-overlay-right' data-testid='gs-udemy-right' />}
      {anchor !== 'left' && <div className='ud-gs-overlay ud-gs-overlay-left' data-testid='gs-udemy-left' />}
    </div>
  );
}

function RewriteRow({ items, rtl }: { items: string[]; rtl: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<FadeState>({ start: false, end: false });
  useEffect(() => (ref.current ? watchFade(ref.current, setState) : undefined), []);
  return (
    <div
      ref={ref}
      className='ud-gs-row'
      dir={rtl ? 'rtl' : 'ltr'}
      data-testid='gs-rewrite'
      data-fade={`${state.start ? 'start' : ''}${state.end ? 'end' : ''}` || 'none'}
      style={{ maskImage: fadeMask(state, 48, rtl), WebkitMaskImage: fadeMask(state, 48, rtl) }}
    >
      <div className='ud-gs-track'>
        {items.map((t) => (
          <span key={t} className='ud-gs-chip'>{t}</span>
        ))}
      </div>
    </div>
  );
}

function GradientSection() {
  const [many, setMany] = useState(true);
  const [rtl, setRtl] = useState(false);
  const items = many ? TOPICS : TOPICS.slice(0, 3);
  return (
    <section className='card ud-gs'>
      <h2>2. Mép cuộn mờ dần</h2>
      <p className='hint'>
        Cuộn hai hàng chủ đề. Bớt chip cho vừa khung: kiểu Udemy vẫn phủ mờ mép phải dù không còn gì để cuộn. Chuyển
        theme tối: lớp phủ màu trắng hiện thành vệt sáng; mask-image thì mờ về trong suốt nên hợp mọi nền.
      </p>
      <div className='toolbar'>
        <button aria-pressed={!many} onClick={() => setMany(!many)}>
          {many ? 'Bớt còn 3 chip' : 'Đủ 14 chip'}
        </button>
        <button aria-pressed={rtl} onClick={() => setRtl(!rtl)}>
          Hướng chữ: {rtl ? 'RTL' : 'LTR'}
        </button>
      </div>
      <p className='ud-gs-label'>Kiểu Udemy (lớp phủ trắng, trạng thái ban đầu "left")</p>
      <UdemyStyleRow key={`u-${many}-${rtl}`} items={items} rtl={rtl} />
      <p className='ud-gs-label'>Viết lại (mask-image, theo dõi cả đổi kích thước)</p>
      <RewriteRow key={`r-${many}-${rtl}`} items={items} rtl={rtl} />
    </section>
  );
}

export default function UdResizerDemo() {
  return (
    <div className='page'>
      <h1>Kéo mép để đổi kích thước, mép cuộn mờ dần</h1>
      <ResizeSection />
      <GradientSection />
    </div>
  );
}

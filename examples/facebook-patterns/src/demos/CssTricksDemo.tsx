import { useRef, useState } from 'react';
import {
  arrowWhenOverflowing,
  containerSwitch,
  facepileBreakpoint,
  facepilePusher,
  leadingTrimCSS,
  overflowEllipsis,
  radiusUnlessFullBleed,
} from '../lib/cssOverflowTricks';
import './CssTricksDemo.css';

const AVATAR = 36;
const GAP = 6;
const COLORS = ['#f2466b', '#ff8a3d', '#f0b03a', '#34d399', '#3b82f6', '#a78bfa', '#ec4899', '#14b8a6'];
const NAMES = ['An', 'Bình', 'Chi', 'Dũng', 'Giang', 'Hà', 'Khoa', 'Linh'];

const SLIDE = 120;
const SLIDE_GAP = 8;
const SLIDES = 4;

const LINE_HEIGHT = 20;
const CLAMP = overflowEllipsis(LINE_HEIGHT, 2);

const SHORT_TEXT = 'Một dòng ngắn: không có "…".';
const MEDIUM_TEXT =
  'Đoạn vừa phải: khung rộng thì vừa 2 dòng, không có dấu ba chấm; kéo hẹp lại thì tràn và "…" tự hiện.';
const LONG_TEXT =
  'Bài viết dài: Facebook giới hạn chiều cao đúng 2 dòng + 0.1px. Dấu ba chấm chỉ hiện khi chữ thật sự bị cắt, nhờ max-height của nó được tính bằng calc((100% - 40px) * 999). Không có dòng JS nào đo chiều cao chữ.';

function Facepile() {
  const all = facepileBreakpoint(NAMES.length, AVATAR, GAP);
  return (
    <div className='ct-pile'>
      <div className='ct-pile-row'>
        {NAMES.map((name, i) => (
          <div key={name} style={{ display: 'contents' }}>
            <div style={facepilePusher(i, AVATAR, GAP)} aria-hidden />
            <div className='ct-avatar' style={{ background: COLORS[i] }} title={name}>
              {name[0]}
            </div>
          </div>
        ))}
      </div>
      {/* lớp phủ: bong bóng "…" đè lên avatar cuối cùng còn thấy được */}
      <div className='ct-pile-overlay' aria-hidden>
        {NAMES.slice(1).map((name, i) => (
          <div key={name} style={containerSwitch(facepileBreakpoint(i + 2, AVATAR, GAP), 'whenAtLeast', AVATAR + GAP)} />
        ))}
        <div className='ct-switch-wrap' style={containerSwitch(all, 'whenBelow', AVATAR)}>
          <div className='ct-more'>…</div>
        </div>
      </div>
    </div>
  );
}

function Carousel() {
  const trackRef = useRef<HTMLDivElement>(null);
  const arrow = arrowWhenOverflowing(SLIDES, SLIDE, SLIDE_GAP, 48);
  const page = (dir: number) => {
    const el = trackRef.current;
    if (el) el.scrollBy({ left: dir * (el.clientWidth - 40), behavior: 'smooth' });
  };
  return (
    <div className='ct-carousel'>
      <div style={arrow}>
        <button className='ct-arrow' aria-label='Trước' onClick={() => page(-1)}>
          ‹
        </button>
      </div>
      <div className='ct-track' ref={trackRef}>
        {Array.from({ length: SLIDES }, (_, i) => (
          <div key={i} className='ct-slide' style={{ background: COLORS[i] }}>
            Thẻ {i + 1}
          </div>
        ))}
      </div>
      <div style={arrow}>
        <button className='ct-arrow' aria-label='Sau' onClick={() => page(1)}>
          ›
        </button>
      </div>
    </div>
  );
}

function Clamp({ text }: { text: string }) {
  return (
    <span className='ct-clamp' style={CLAMP.root}>
      {text}
      <span className='ct-clamp-ellipsis' style={CLAMP.ellipsis} aria-hidden>
        …
      </span>
    </span>
  );
}

const TRIM_CSS = leadingTrimCSS('.ct-trimmed', [4, 5]);

export default function CssTricksDemo() {
  const [width, setWidth] = useState(560);
  const [cardVw, setCardVw] = useState(80);
  const [trim, setTrim] = useState(true);

  return (
    // clip: card rộng 100vw không tạo thanh cuộn ngang khi trang có thanh cuộn dọc cổ điển
    <div className='page' style={{ overflowX: 'clip' }}>
      <style>{TRIM_CSS}</style>
      <h1>Mẹo calc(… * 9999)</h1>
      <p className='hint'>
        Kéo slider để đổi chiều rộng khung. Mọi thay đổi bên trong đều do CSS tự tính: không có
        ResizeObserver, không đo DOM, không re-render theo kích thước.
      </p>

      <section className='ct-section'>
        <h2>1. Card: bo góc khi nhỏ hơn màn hình, vuông khi tràn viền</h2>
        <div className='ct-range'>
          <label htmlFor='ct-card'>Card rộng {cardVw}vw</label>
          <input id='ct-card' type='range' min={50} max={100} value={cardVw} onChange={(e) => setCardVw(+e.target.value)} />
        </div>
        <div className='ct-card-stage' style={{ width: `${cardVw}vw` }}>
          <div className='ct-card' style={{ borderRadius: radiusUnlessFullBleed(16) }}>
            <code>border-radius: {radiusUnlessFullBleed(16)}</code>
          </div>
        </div>
      </section>

      <div className='ct-range'>
        <label htmlFor='ct-width'>Khung rộng {width}px</label>
        <input id='ct-width' type='range' min={120} max={720} value={width} onChange={(e) => setWidth(+e.target.value)} />
      </div>

      <section className='ct-section'>
        <h2>2. Facepile: avatar không vừa thì tự ẩn, "…" thế chỗ</h2>
        <div className='ct-frame' style={{ width }}>
          <Facepile />
        </div>
      </section>

      <section className='ct-section'>
        <h2>3. Dấu "…" chỉ hiện khi chữ thật sự tràn 2 dòng</h2>
        <div className='ct-frame' style={{ width }}>
          <Clamp text={SHORT_TEXT} />
          <Clamp text={MEDIUM_TEXT} />
          <Clamp text={LONG_TEXT} />
        </div>
      </section>

      <section className='ct-section'>
        <h2>4. Mũi tên carousel chỉ hiện khi các thẻ không vừa khung</h2>
        <div className='ct-frame' style={{ width }}>
          <Carousel />
        </div>
      </section>

      <section className='ct-section'>
        <h2>5. Cắt leading thừa (viền cam = hộp của dòng chữ)</h2>
        <label className='switch' style={{ marginBottom: 8 }}>
          <input type='checkbox' checked={trim} onChange={(e) => setTrim(e.target.checked)} />
          Cắt 4px trên, 5px dưới
        </label>
        <div className='ct-trim-box'>
          <span className={trim ? 'ct-trimmed' : undefined} style={{ display: 'block' }}>
            HÔM NAY trời đẹp, chữ hoa chạm sát viền trên khi đã cắt.
          </span>
        </div>
      </section>
    </div>
  );
}

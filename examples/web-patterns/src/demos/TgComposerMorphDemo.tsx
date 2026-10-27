import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { calcMorphScales, morphVars, Transition, useSlidingIndicator, type TransitionName } from '../lib/tgTransition';
import { Stat, useLog, Log } from './shared';
import './TgComposerMorphDemo.css';

const TABS = ['Tất cả', 'Cá nhân', 'Công việc', 'Nhóm', 'Kênh', 'Bot', 'Chưa đọc', 'Lưu trữ'];
const SEND_BUTTON = 56;
// contentRect của ResizeObserver đã trừ padding của footer, nên không trừ thêm lần nữa
const SIDE_PADDING = 0;
const MAX_TOOLBAR = 512;

export default function TgComposerMorphDemo() {
  return (
    <div className='page tgcm'>
      <h1>Composer biến hình, Transition và gạch chân tab</h1>
      <p className='hint'>
        Ba kiểu chuyển cảnh trong Telegram Web, đều chỉ dùng <code>transform</code> và <code>opacity</code>.
      </p>
      <ComposerMorph />
      <TabsAndPanels />
    </div>
  );
}

function ComposerMorph() {
  const footerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selecting, setSelecting] = useState(false);
  const [morph, setMorph] = useState(true);
  const [selected, setSelected] = useState(3);

  // Telegram tính từ bề rộng cửa sổ theo đúng công thức layout; ở đây vùng chứa có thể co giãn
  // nên đo bề rộng bằng ResizeObserver. Quan trọng là lúc BẤM không đo gì cả.
  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const input = { containerWidth: width, sidePadding: SIDE_PADDING, sendButtonWidth: SEND_BUTTON, maxToolbarWidth: MAX_TOOLBAR };
  const m = width ? calcMorphScales(input) : undefined;

  return (
    <section className='card tgcm-section'>
      <h2>1. Ô soạn tin ⇄ thanh chọn tin</h2>
      <div className='toolbar'>
        <button className='primary' data-testid='toggle-select' onClick={() => setSelecting((s) => !s)}>
          {selecting ? 'Huỷ chọn' : 'Chọn tin nhắn'}
        </button>
        <label>
          <input type='checkbox' checked={morph} onChange={(e) => setMorph(e.target.checked)} /> Biến hình (tắt = chỉ mờ dần)
        </label>
      </div>
      <div className='tgcm-chat'>
        <div className='tgcm-messages'>
          {[0, 1, 2, 3].map((i) => (
            <button
              key={i}
              className={`tgcm-msg ${i % 2 ? 'own' : ''} ${selecting && i < selected ? 'picked' : ''}`}
              onClick={() => selecting && setSelected(i + 1)}
            >
              {['Tối nay họp lúc mấy giờ?', '8 giờ nhé', 'Ok, mình sẽ mang laptop', 'Nhớ mang theo bản thiết kế'][i]}
            </button>
          ))}
        </div>
        <div
          ref={footerRef}
          className={`tgcm-footer ${selecting ? 'select-mode' : ''} ${morph ? 'morph' : 'fade-only'}`}
          style={width ? morphVars(input) : undefined}
        >
          <div className={`tgcm-composer ${selecting ? '' : 'shown'}`}>
            <div className='tgcm-compose' data-testid='composer'>
              <span className='tgcm-compose-inner'>😊 Nhập tin nhắn…</span>
            </div>
            <button className='tgcm-send' aria-label='Gửi' tabIndex={selecting ? -1 : 0}>
              ➤
            </button>
          </div>
          <div className={`tgcm-select ${selecting ? 'shown' : ''}`}>
            <div className='tgcm-select-inner' data-testid='toolbar'>
              <span>✕ Đã chọn {selected}</span>
              <span className='tgcm-select-actions'>↪ 🗑</span>
            </div>
          </div>
        </div>
      </div>
      {m && (
        <div className='stats'>
          <Stat label='bề rộng ô soạn tin' value={`${Math.round(m.composerWidth)}px`} />
          <Stat label='bề rộng thanh chọn' value={`${Math.round(m.toolbarWidth)}px`} />
          <Stat label='scaleX khi ẩn ô soạn' value={m.composerHiddenScale.toFixed(3)} />
          <Stat label='translateX bù nút gửi' value={`${m.composerTranslateX.toFixed(1)}px`} />
        </div>
      )}
    </section>
  );
}

function TabsAndPanels() {
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [name, setName] = useState<TransitionName>('slide');
  const [legacy, setLegacy] = useState(false);
  const [noAnim, setNoAnim] = useState(false);
  const [status, setStatus] = useState<'idle' | 'running'>('idle');
  const startedAt = useRef(0);
  const { lines, add } = useLog(8);
  useSlidingIndicator(listRef, active);

  // đồng hồ hiển thị bao lâu Transition còn ở trạng thái "đang chạy"
  const [, tick] = useState(0);
  useEffect(() => {
    if (status !== 'running') return;
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, [status]);

  return (
    <section className='card tgcm-section'>
      <h2>2. Gạch chân tab trượt + Transition giữa các màn</h2>
      <div className='tgcm-tabs' ref={listRef} role='tablist'>
        {TABS.map((tab, i) => (
          <button
            key={tab}
            role='tab'
            data-tab
            aria-selected={i === active}
            className={i === active ? 'active' : ''}
            onClick={() => setActive(i)}
          >
            <span>
              {tab}
              <i data-indicator />
            </span>
          </button>
        ))}
      </div>
      <div className='toolbar'>
        <label>
          Kiểu
          <select value={name} onChange={(e) => setName(e.target.value as TransitionName)}>
            <option value='slide'>slide</option>
            <option value='slide-fade'>slide-fade</option>
            <option value='zoom-fade'>zoom-fade</option>
            <option value='reveal'>reveal</option>
          </select>
        </label>
        <button onClick={() => setActive(0)}>Về tab đầu</button>
        <button onClick={() => setActive(TABS.length - 1)}>Nhảy tới tab cuối</button>
      </div>
      <Transition
        activeKey={active}
        name={name}
        legacyWait={legacy}
        className={`tgcm-panels ${noAnim ? 'tgcm-noanim' : ''}`}
        onStart={() => {
          startedAt.current = performance.now();
          setStatus('running');
        }}
        onStop={() => {
          setStatus('idle');
          add(`xong sau ${Math.round(performance.now() - startedAt.current)}ms`, 'ok');
        }}
      >
        {(key) => (
          <div className='tgcm-panel' style={{ '--hue': key * 45 } as React.CSSProperties}>
            <b>{TABS[key]}</b>
            <span>Màn #{key + 1}: màn cũ vẫn được render trong lúc trượt ra.</span>
          </div>
        )}
      </Transition>
      <p className='tgcm-status' data-testid='transition-status'>
        Trạng thái Transition:{' '}
        {status === 'running' ? (
          <span className='warn'>đang chạy {Math.round((performance.now() - startedAt.current) / 100) / 10}s</span>
        ) : (
          <span className='ok'>đứng yên</span>
        )}
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={noAnim} onChange={(e) => setNoAnim(e.target.checked)} /> Màn mới không có
          animation (vd. CSS bị ghi đè)
        </label>
        <label>
          <input type='checkbox' checked={legacy} onChange={(e) => setLegacy(e.target.checked)} /> Chờ animationend như bản
          gốc (không hạn chờ)
        </label>
      </div>
      <Log lines={lines} />
    </section>
  );
}

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import { createStickyDates, IS_IOS, keepTabMinHeight, lockScrollForTransition } from '../lib/tgStickyDate';
import './TgStickyDateDemo.css';

// ---------------------------------------------------------------- 1. nhãn ngày

const DAYS = ['Thứ Hai, 20/10', 'Thứ Ba, 21/10', 'Thứ Tư, 22/10', 'Thứ Năm, 23/10', 'Thứ Sáu, 24/10', 'Hôm qua', 'Hôm nay'];
const TEXTS = ['Ok nhé', 'Mai họp lúc 9h', 'Gửi file rồi đó', 'Haha 😂', 'Chiều nay rảnh không?', 'Đã xem', 'Cảm ơn!'];

function StickyDatesSection() {
  const listRef = useRef<HTMLDivElement>(null);
  const [telegramMode, setTelegramMode] = useState(true);
  const [stuck, setStuck] = useState<string>('—');
  const [scrolling, setScrolling] = useState(false);

  useEffect(() => {
    const list = listRef.current!;
    const off = telegramMode ? createStickyDates(list, { stickyTop: 10 }) : () => {};
    // đọc trạng thái để hiện số liệu
    const mo = new MutationObserver(() => {
      setScrolling(list.classList.contains('is-scrolling'));
      setStuck(list.querySelector('.sticky-date.stuck')?.textContent ?? '—');
    });
    mo.observe(list, { attributes: true, subtree: true, attributeFilter: ['class'] });
    list.scrollTop = list.scrollHeight;
    return () => {
      off();
      mo.disconnect();
      list.classList.remove('is-scrolling');
      list.querySelector('.sticky-date.stuck')?.classList.remove('stuck');
    };
  }, [telegramMode]);

  return (
    <section className='tgs-section'>
      <h2>1. Nhãn ngày chỉ hiện khi đang cuộn</h2>
      <p className='hint'>
        Cuộn khung chat. Khi đang cuộn, nhãn ngày dính ở đỉnh để biết mình đang ở ngày nào. Dừng 1 giây thì nhãn đang
        dính mờ đi, không che tin nhắn. Các nhãn khác (nằm giữa danh sách) vẫn hiện bình thường.
      </p>
      <div className='toolbar'>
        <label>
          <input type='checkbox' checked={telegramMode} onChange={(e) => setTelegramMode(e.target.checked)} /> Ẩn nhãn khi
          đứng yên (Telegram)
        </label>
      </div>
      <div className='stats'>
        <Stat label='đang cuộn' value={scrolling ? 'có' : 'không'} />
        <Stat label='nhãn đang dính (ẩn)' value={<span data-testid='tgs-stuck'>{stuck}</span>} />
      </div>
      <div ref={listRef} className='tgs-list' data-testid='tgs-list'>
        {DAYS.map((day, d) => (
          <div key={day} className='tgs-day'>
            <div className='sticky-date'>
              <span>{day}</span>
            </div>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={`tgs-msg ${(d + i) % 3 === 0 ? 'own' : ''}`}>
                {TEXTS[(d * 3 + i) % TEXTS.length]}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 2. đổi tab

type LockMode = 'none' | 'hidden' | 'telegram';

const LONG = Array.from({ length: 30 }, (_, i) => `Ảnh ${i + 1}`);
const SHORT = ['telegram.org', 'github.com/Ajaxy/telegram-tt'];

function TabsSection() {
  const boxRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'media' | 'links'>('media');
  const [mode, setMode] = useState<LockMode>('telegram');
  const [keepHeight, setKeepHeight] = useState(true);
  const [animating, setAnimating] = useState(false);
  const log = useLog(8);

  useLayoutEffect(() => {
    if (!keepHeight) {
      contentRef.current!.style.minHeight = '';
      return;
    }
    return keepTabMinHeight(boxRef.current!, contentRef.current!, tabsRef.current!);
  }, [keepHeight]);

  const switchTab = (next: 'media' | 'links') => {
    if (next === tab || animating) return;
    const box = boxRef.current!;
    const widthBefore = contentRef.current!.getBoundingClientRect().width;
    const tabsTopBefore = tabsRef.current!.getBoundingClientRect().top - box.getBoundingClientRect().top;

    let release = () => {};
    if (mode === 'telegram') release = lockScrollForTransition(box);
    if (mode === 'hidden') {
      const prev = box.style.overflowY;
      box.style.overflowY = 'hidden';
      release = () => {
        box.style.overflowY = prev;
      };
    }
    const widthDuring = contentRef.current!.getBoundingClientRect().width;
    setAnimating(true);
    setTab(next);

    setTimeout(() => {
      release();
      setAnimating(false);
      const tabsTopAfter = tabsRef.current!.getBoundingClientRect().top - box.getBoundingClientRect().top;
      const shift = Math.round(widthDuring - widthBefore);
      const jump = Math.round(tabsTopAfter - tabsTopBefore);
      log.add(
        `→ ${next === 'media' ? 'Ảnh' : 'Link'}: nội dung xô ngang ${shift}px, thanh tab dịch ${jump}px`,
        shift === 0 && jump === 0 ? 'ok' : 'warn',
      );
    }, 320);
  };

  return (
    <section className='tgs-section'>
      <h2>2. Đổi tab mà không xô layout</h2>
      <p className='hint'>
        Cuộn xuống tới khi thanh tab chạm đỉnh khung, rồi đổi qua tab ngắn. Không có <code>min-height</code> thì khung co
        lại, thanh tab tụt xuống. Tắt cuộn trong lúc trượt mà không bù bề rộng thanh cuộn thì nội dung xô sang phải.
      </p>
      <div className='toolbar'>
        <label>
          <input type='radio' checked={mode === 'none'} onChange={() => setMode('none')} /> Không khoá
        </label>
        <label>
          <input type='radio' checked={mode === 'hidden'} onChange={() => setMode('hidden')} /> overflow: hidden (không bù)
        </label>
        <label>
          <input type='radio' checked={mode === 'telegram'} onChange={() => setMode('telegram')} /> hidden + bù margin
          (Telegram)
        </label>
        <label>
          <input type='checkbox' checked={keepHeight} onChange={(e) => setKeepHeight(e.target.checked)} /> giữ min-height
        </label>
      </div>
      <div ref={boxRef} className='tgs-profile' data-testid='tgs-profile'>
        <div className='tgs-info'>
          <div className='tgs-avatar'>L</div>
          <b>Lan</b>
          <span className='muted'>online</span>
        </div>
        <div ref={tabsRef} className='tgs-tabs' role='tablist'>
          <button role='tab' aria-selected={tab === 'media'} onClick={() => switchTab('media')}>
            Ảnh (dài)
          </button>
          <button role='tab' aria-selected={tab === 'links'} onClick={() => switchTab('links')}>
            Link (ngắn)
          </button>
        </div>
        <div ref={contentRef} className={`tgs-content ${animating ? 'sliding' : ''}`} data-testid='tgs-content'>
          {(tab === 'media' ? LONG : SHORT).map((x) => (
            <div key={x} className='tgs-row'>
              {x}
            </div>
          ))}
        </div>
      </div>
      <Log lines={log.lines} />
    </section>
  );
}

export default function TgStickyDateDemo() {
  return (
    <div className='page tgs'>
      <h1>Telegram: ngày dính, khoá cuộn khi đổi tab</h1>
      <StickyDatesSection />
      <TabsSection />
      <section className='tgs-section'>
        <h2>3. Dừng quán tính cuộn trên iOS</h2>
        <p className='hint'>
          Chỉ thấy được trên iPhone/iPad: đang vuốt mạnh mà code gán <code>scrollTop</code> thì quán tính ghi đè lại.
          Telegram tắt <code>overflow</code> một nhịp rồi bật lại. Thiết bị này: <b>{IS_IOS ? 'iOS' : 'không phải iOS'}</b>.
        </p>
      </section>
    </div>
  );
}

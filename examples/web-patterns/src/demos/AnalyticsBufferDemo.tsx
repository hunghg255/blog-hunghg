import { useEffect, useRef, useState } from 'react';
import { createAnalyticsBuffer, type AnalyticsEvent } from '../lib/analyticsBuffer';
import { BAIT_CLASSES, detectAdBlocker } from '../lib/analyticsAdblock';
import { Log, Stat, useLog } from './shared';
import './AnalyticsBufferDemo.css';

const isPageView = (e: AnalyticsEvent) => e.name === 'PAGE_LOAD';

/**
 * Mô phỏng lại eventBuffer.ts của Best Buy (không phải mã nguồn gốc): một mảng vòng 50 phần tử chung cho mọi sự kiện,
 * kể cả PAGE_LOAD. Khi SDK tải xong: có PAGE_LOAD trong mảng thì gửi nó trước rồi gửi phần còn lại; không có thì chờ.
 */
function createBestBuyBuffer() {
  const cached: AnalyticsEvent[] = [];
  let mode: 'cache' | 'wait-page-load' | 'direct' = 'cache';
  let sink: (e: AnalyticsEvent) => void = () => {};
  const cache = (e: AnalyticsEvent) => {
    if (cached.length >= 50) cached.shift();
    cached.push(e);
  };
  const flushAfter = (pageLoad: AnalyticsEvent) => {
    sink(pageLoad);
    cached.splice(0).forEach(sink);
    mode = 'direct';
  };
  return {
    track(e: AnalyticsEvent) {
      if (mode === 'direct') sink(e);
      else if (mode === 'wait-page-load' && isPageView(e)) flushAfter(e);
      else cache(e);
    },
    connect(send: (e: AnalyticsEvent) => void) {
      sink = send;
      const index = cached.findIndex(isPageView);
      if (index === -1) mode = 'wait-page-load';
      else flushAfter(cached.splice(index, 1)[0]);
    },
  };
}

function Received({ title, events, good }: { title: string; events: AnalyticsEvent[]; good: boolean }) {
  const pageView = events.findIndex(isPageView);
  const overflow = events.find((e) => e.name === 'analytics_buffer_overflow');
  return (
    <div className='ab-column'>
      <b className={good ? 'ok' : 'warn'}>{title}</b>
      <div className='stats'>
        <Stat label='SDK nhận được' value={events.length} />
        <Stat label='vị trí PAGE_LOAD' value={pageView === -1 ? 'mất' : `#${pageView + 1}`} />
      </div>
      {overflow && <small className='warn'>Báo mất {String(overflow.data?.dropped)} sự kiện</small>}
      <ol className='ab-events'>
        {events.slice(0, 6).map((e, i) => (
          <li key={i} className={isPageView(e) ? 'ok' : e.name === 'analytics_buffer_overflow' ? 'warn' : ''}>
            {e.name}
          </li>
        ))}
        
      </ol>
      {events.length > 6 && <small className='muted'>… và {events.length - 6} sự kiện nữa</small>}
    </div>
  );
}

export default function AnalyticsBufferDemo() {
  const { lines, add } = useLog();
  const buffersRef = useRef<{ bestBuy: ReturnType<typeof createBestBuyBuffer>; ours: ReturnType<typeof createAnalyticsBuffer> } | null>(null);
  const [received, setReceived] = useState<{ bestBuy: AnalyticsEvent[]; ours: AnalyticsEvent[] }>({ bestBuy: [], ours: [] });
  const [phase, setPhase] = useState<'closed' | 'open' | 'ready'>('closed');
  const [sent, setSent] = useState(0);
  const [blocker, setBlocker] = useState<'none' | 'css' | 'slow'>('none');
  const [checks, setChecks] = useState<string[]>([]);

  function openPage() {
    buffersRef.current = { bestBuy: createBestBuyBuffer(), ours: createAnalyticsBuffer({ max: 50, isPriority: isPageView }) };
    setReceived({ bestBuy: [], ours: [] });
    setPhase('open');
    setSent(0);
    track('PAGE_LOAD');
    add('Mở trang: PAGE_LOAD vào hàng đợi, SDK analytics chưa tải', 'muted');
  }

  function track(name: string) {
    const b = buffersRef.current;
    if (!b) return;
    const event = { name, at: performance.now() };
    b.bestBuy.track(event);
    b.ours.track(name);
    setSent((n) => n + 1);
  }

  function burst(count: number) {
    const names = ['SCROLL', 'PRODUCT_VIEW', 'ADD_TO_CART_HOVER', 'FILTER_CHANGE'];
    for (let i = 0; i < count; i++) track(names[i % names.length]);
    add(`Bắn ${count} sự kiện trước khi SDK tải xong`, 'muted');
  }

  function loadSdk() {
    const b = buffersRef.current;
    if (!b) return;
    const bestBuy: AnalyticsEvent[] = [];
    const ours: AnalyticsEvent[] = [];
    b.bestBuy.connect((e) => bestBuy.push(e));
    b.ours.connect((e) => ours.push(e));
    setReceived({ bestBuy: [...bestBuy], ours: [...ours] });
    setPhase('ready');
    add(`SDK tải xong. Best Buy gửi ${bestBuy.length}, bản viết lại gửi ${ours.length}`, 'ok');
  }

  // Trình chặn giả lập: 'css' chèn stylesheet ngay (giống bộ lọc ẩn phần tử), 'slow' ẩn mồi sau 50ms
  useEffect(() => {
    if (blocker === 'none') return;
    if (blocker === 'css') {
      const style = document.createElement('style');
      style.textContent = '.adBanner, .textAd { display: none !important; }';
      document.head.appendChild(style);
      return () => style.remove();
    }
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('adBanner')) {
            setTimeout(() => node.style.setProperty('display', 'none', 'important'), 50);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [blocker]);

  function checkBestBuy() {
    // kiểu Best Buy: tạo mồi, kiểm tra NGAY, không gỡ mồi
    const bait = document.createElement('div');
    bait.className = BAIT_CLASSES;
    bait.setAttribute('style', 'width:1px!important;height:1px!important;position:absolute!important;left:-10000px!important;top:-1000px!important;');
    document.body.appendChild(bait);
    const blocked = bait.offsetParent == null || bait.offsetHeight === 0 || bait.offsetWidth === 0;
    const leftovers = document.body.querySelectorAll('.adBanner').length;
    setChecks((prev) => [`Best Buy: ${blocked ? 'có chặn' : 'không chặn'} · mồi còn trong DOM: ${leftovers}`, ...prev].slice(0, 6));
  }

  async function checkOurs() {
    const blocked = await detectAdBlocker();
    // bản viết lại tự gỡ mồi của mình; mồi còn lại (nếu có) là của các lần kiểm tra kiểu Best Buy
    setChecks((prev) => [`Bản viết lại: ${blocked ? 'có chặn' : 'không chặn'} · đã gỡ mồi của mình`, ...prev].slice(0, 6));
  }

  function clearBaits() {
    document.body.querySelectorAll('.adBanner').forEach((el) => el.remove());
    setChecks([]);
  }

  return (
    <div className='page ab'>
      <h1>Buffer analytics chờ SDK, phát hiện trình chặn quảng cáo</h1>

      <section className='card ab-section'>
        <h2>Hàng đợi sự kiện trước khi SDK tải xong</h2>
        <p className='hint'>
          Mở trang (bắn PAGE_LOAD), bắn thêm 60 sự kiện, rồi cho SDK tải xong. Hàng đợi vòng 50 phần tử của Best Buy đẩy
          PAGE_LOAD ra ngoài: SDK không nhận được gì cho tới lần mở trang sau.
        </p>
        <div className='toolbar'>
          <button className='primary' onClick={openPage}>
            1. Mở trang
          </button>
          <button onClick={() => burst(60)} disabled={phase !== 'open'}>
            2. Bắn 60 sự kiện
          </button>
          <button onClick={() => burst(5)} disabled={phase !== 'open'}>
            Bắn 5 sự kiện
          </button>
          <button className='primary' onClick={loadSdk} disabled={phase !== 'open'}>
            3. SDK tải xong
          </button>
          <span className='muted'>đã bắn {sent}</span>
        </div>
        {phase === 'ready' && (
          <div className='ab-compare'>
            <Received title='Kiểu Best Buy (vòng 50, chung mọi sự kiện)' events={received.bestBuy} good={false} />
            <Received title='Bản viết lại (page view không bị bỏ)' events={received.ours} good />
          </div>
        )}
      </section>

      <section className='card ab-section'>
        <h2>Phát hiện trình chặn quảng cáo bằng phần tử mồi</h2>
        <div className='toolbar' role='group' aria-label='Trình chặn giả lập'>
          <button className={blocker === 'none' ? 'primary' : ''} onClick={() => setBlocker('none')}>
            Không có trình chặn
          </button>
          <button className={blocker === 'css' ? 'primary' : ''} onClick={() => setBlocker('css')}>
            Trình chặn bằng CSS
          </button>
          <button className={blocker === 'slow' ? 'primary' : ''} onClick={() => setBlocker('slow')}>
            Trình chặn ẩn trễ 50ms
          </button>
        </div>
        <div className='toolbar'>
          <button onClick={checkBestBuy}>Kiểm tra kiểu Best Buy</button>
          <button className='primary' onClick={checkOurs}>
            Kiểm tra bản viết lại
          </button>
          <button onClick={clearBaits}>Dọn mồi</button>
        </div>
        <ul className='ab-checks'>
          {checks.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </section>

      <Log lines={lines} />
    </div>
  );
}

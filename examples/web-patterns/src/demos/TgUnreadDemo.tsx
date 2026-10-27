import { useEffect, useMemo, useRef, useState } from 'react';
import { Log, useLog } from './shared';
import { bindPageVisibility, createDeleteBuffer, createUnreadIndicator, drawBadgeFavicon } from '../lib/tgUnreadIndicator';
import './TgUnreadDemo.css';

const BASE = 'Telegram';

// ---------------------------------------------------------------- 1. tiêu đề + favicon

interface FakeTab {
  title: string;
  badge: number | null;
}

/**
 * Mô phỏng bản gốc (không phải mã Telegram): lúc rời tab chụp tổng chưa đọc, mỗi nhịp tính
 * `tổng hiện tại - tổng lúc rời`, chỉ báo khi hiệu > 0.
 */
function createLikeOriginal(getUnread: () => number, set: (t: FakeTab) => void) {
  let timer: ReturnType<typeof setInterval> | undefined;
  return {
    leave() {
      const initial = getUnread();
      let index = 0;
      clearInterval(timer);
      timer = setInterval(() => {
        if (index % 2 === 0) {
          const diff = getUnread() - initial;
          if (diff > 0) set({ title: `${diff} tin nhắn mới`, badge: diff });
        } else {
          set({ title: BASE, badge: null });
        }
        index++;
      }, 1000);
    },
    back() {
      clearInterval(timer);
      set({ title: BASE, badge: null });
    },
    destroy: () => clearInterval(timer),
  };
}

function Tab({ tab, label }: { tab: FakeTab; label: string }) {
  const icon = useMemo(() => drawBadgeFavicon(tab.badge), [tab.badge]);
  return (
    <figure className='tgn-tabfig'>
      <div className='tgn-tab' data-testid={`tgn-tab-${label}`}>
        <img src={icon} alt='' width={16} height={16} />
        <span>{tab.title}</span>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}

function TitleSection() {
  const [away, setAway] = useState(false);
  const [total, setTotal] = useState(12);
  const totalRef = useRef(total);
  totalRef.current = total;
  const [origTab, setOrigTab] = useState<FakeTab>({ title: BASE, badge: null });
  const [fixedTab, setFixedTab] = useState<FakeTab>({ title: BASE, badge: null });
  const [applyReal, setApplyReal] = useState(false);
  const applyRealRef = useRef(applyReal);
  applyRealRef.current = applyReal;
  const log = useLog(8);

  const orig = useMemo(() => createLikeOriginal(() => totalRef.current, setOrigTab), []);
  const fixed = useMemo(
    () =>
      createUnreadIndicator({
        baseTitle: BASE,
        setTitle: (title) => {
          setFixedTab((t) => ({ ...t, title }));
          if (applyRealRef.current && document.title !== title) document.title = title;
        },
        setBadge: (badge) => {
          setFixedTab((t) => ({ ...t, badge }));
          if (applyRealRef.current) setRealFavicon(drawBadgeFavicon(badge));
        },
      }),
    [],
  );

  useEffect(() => () => {
    orig.destroy();
    fixed.destroy();
  }, [orig, fixed]);

  // Khi mở demo toàn màn hình: rời tab thật cũng kích hoạt bản sửa
  useEffect(() => {
    if (!applyReal) return;
    return bindPageVisibility({
      leave: () => {
        fixed.leave();
        setAway(true);
      },
      back: () => {
        fixed.back();
        setAway(false);
      },
    });
  }, [applyReal, fixed]);

  const toggleAway = () => {
    if (away) {
      orig.back();
      fixed.back();
      log.add('quay lại tab', 'muted');
    } else {
      orig.leave();
      fixed.leave();
      log.add(`rời tab (lúc này có ${totalRef.current} tin chưa đọc)`, 'muted');
    }
    setAway(!away);
  };

  const incoming = (n: number) => {
    setTotal((t) => t + n);
    fixed.incoming(n);
    log.add(`+${n} tin mới`, 'ok');
  };

  const readElsewhere = () => {
    setTotal((t) => Math.max(0, t - 5));
    log.add('đọc 5 tin trên điện thoại (tổng chưa đọc giảm 5)', 'warn');
  };

  return (
    <section className='tgn-section'>
      <h2>1. Tiêu đề nhấp nháy và favicon có chấm đỏ</h2>
      <p className='hint'>
        Bấm "Rời tab", cho vài tin mới tới. Thử thêm "Đọc 5 tin trên điện thoại" trước khi có tin mới: bản gốc tính hiệu
        số tổng chưa đọc nên không báo gì.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={toggleAway}>
          {away ? 'Quay lại tab' : 'Rời tab'}
        </button>
        <button onClick={() => incoming(1)}>+1 tin mới</button>
        <button onClick={() => incoming(3)}>+3 tin mới</button>
        <button onClick={readElsewhere}>Đọc 5 tin trên điện thoại</button>
      </div>
      <p className='muted'>
        Tổng chưa đọc: <b data-testid='tgn-total'>{total}</b> · {away ? 'đang ở tab khác' : 'đang xem tab này'}
      </p>
      <div className='tgn-tabs'>
        <Tab tab={origTab} label='kiểu bản gốc' />
        <Tab tab={fixedTab} label='bản sửa' />
      </div>
      <label className='tgn-real'>
        <input type='checkbox' checked={applyReal} onChange={(e) => setApplyReal(e.target.checked)} /> Áp bản sửa vào tab
        thật (mở demo toàn màn hình rồi chuyển tab)
      </label>
      <Log lines={log.lines} />
    </section>
  );
}

function setRealFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  link.href = href;
}

// ---------------------------------------------------------------- 2. xoá tới trước tin mới

function DeleteSection() {
  const [delay, setDelay] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ original: number[]; fixed: number[] } | null>(null);
  const log = useLog(10);

  const run = () => {
    setBusy(true);
    setResult(null);
    const original = new Set<number>([40, 41]);
    const fixedSet = new Set<number>([40, 41]);
    const fixed = createDeleteBuffer({
      has: (id) => fixedSet.has(id),
      add: (id) => fixedSet.add(id),
      remove: (id) => fixedSet.delete(id),
    });
    const t0 = performance.now();
    const at = () => `${Math.round(performance.now() - t0)}ms`;

    // t=0: update "xoá 42" tới trước, tin 42 chưa có
    log.add(`${at()}: nhận "xoá #42" (chưa thấy #42)`, 'warn');
    // bản gốc: id chưa thấy thì hẹn 1 giây rồi phát lại lệnh xoá
    setTimeout(() => {
      const arrived = original.delete(42);
      log.add(`${at()}: [bản gốc] phát lại "xoá #42": ${arrived ? 'đã xoá' : '#42 chưa về, không xoá được gì'}`, arrived ? 'ok' : 'muted');
    }, 1000);
    fixed.onDelete([42]);

    setTimeout(() => {
      original.add(42);
      const kept = fixed.onNewMessage(42);
      log.add(`${at()}: nhận tin mới #42; bản sửa ${kept ? 'thêm vào' : 'bỏ (đã có bia mộ)'}`, kept ? 'err' : 'ok');
    }, delay);

    setTimeout(() => {
      setResult({ original: [...original].sort(), fixed: [...fixedSet].sort() });
      setBusy(false);
    }, Math.max(delay, 1000) + 200);
  };

  return (
    <section className='tgn-section'>
      <h2>2. Lệnh "xoá" tới trước tin nhắn</h2>
      <p className='hint'>
        Chat có tin #40, #41. Server gửi "xoá #42" trước, tin #42 tới sau. Bản gốc hẹn 1 giây rồi xoá lại; tin tới trễ
        hơn 1 giây thì thành tin ma.
      </p>
      <div className='toolbar'>
        <label className='tgn-range'>
          Tin #42 tới sau <b>{delay}ms</b>
          <input type='range' min={200} max={3000} step={100} value={delay} onChange={(e) => setDelay(+e.target.value)} />
        </label>
        <button className='primary' disabled={busy} onClick={run}>
          Chạy
        </button>
      </div>
      {result && (
        <div className='stats'>
          <div className='stat'>
            <b data-testid='tgn-del-original' className={result.original.includes(42) ? 'err' : 'ok'}>
              {result.original.map((id) => `#${id}`).join(' ')}
            </b>
            <span>kiểu bản gốc</span>
          </div>
          <div className='stat'>
            <b data-testid='tgn-del-fixed' className={result.fixed.includes(42) ? 'err' : 'ok'}>
              {result.fixed.map((id) => `#${id}`).join(' ')}
            </b>
            <span>bản sửa (bia mộ)</span>
          </div>
        </div>
      )}
      <Log lines={log.lines} />
    </section>
  );
}

export default function TgUnreadDemo() {
  return (
    <div className='page tgn'>
      <h1>Telegram: tiêu đề nhấp nháy, favicon đếm tin mới</h1>
      <TitleSection />
      <DeleteSection />
    </div>
  );
}

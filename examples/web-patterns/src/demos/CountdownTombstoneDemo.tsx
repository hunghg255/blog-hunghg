import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { activeStageIndex, clock, useCountdown, useNow, type Stage } from '../lib/countdown';
import { cartTotal, flagRemoved, mergeTombstones, type Shipment } from '../lib/cartTombstone';
import { Log, sleep, useLog } from './shared';
import './CountdownTombstoneDemo.css';

const HOUR = 3_600_000;
const fmt = (ms: number) =>
  new Date(ms).toLocaleString('vi-VN', { hour12: false, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const pad = (n: number) => String(n).padStart(2, '0');

// ---------- Phần 1: banner flash sale theo lịch + du hành thời gian ----------

function FlashSale() {
  // lịch cố định tính từ lúc mở trang: sale bắt đầu sau 2 ngày, kéo dài 6 giờ
  const [stages] = useState<Stage<{ label: string; tone: string }>[]>(() => {
    const start = Math.ceil((Date.now() + 48 * HOUR) / HOUR) * HOUR;
    return [
      { start: 0, end: start, data: { label: 'Sắp diễn ra', tone: 'warn' } },
      { start, end: start + 6 * HOUR, data: { label: 'Đang sale -50%', tone: 'ok' } },
      { start: start + 6 * HOUR, data: { label: 'Đã kết thúc', tone: 'muted' } },
    ];
  });
  const now = useNow();
  const offset = useSyncExternalStore(clock.subscribe, clock.getOffset);
  const stageIndex = activeStageIndex(stages, now);
  const stage = stages[stageIndex];
  const target = stageIndex === 0 ? stages[1].start : stages[1].end!;
  const left = useCountdown(target);

  return (
    <div className='card ct-sale'>
      <div className='ct-sale-head'>
        <b>Flash sale tai nghe</b>
        <span className={`badge ${stage.data.tone}`}>{stage.data.label}</span>
      </div>
      {stageIndex < 2 ? (
        <div className='ct-clock' aria-live='off'>
          <span>{stageIndex === 0 ? 'Bắt đầu sau' : 'Kết thúc sau'}</span>
          <b>
            {left.days}n {pad(left.hours)}:{pad(left.minutes)}:{pad(left.seconds)}
          </b>
        </div>
      ) : (
        <div className='ct-clock'>
          <span>Hẹn bạn lần sau 👋</span>
        </div>
      )}
      <div className='ct-qa'>
        <div>
          <b>QA · du hành thời gian</b>{' '}
          <span className='muted'>
            đang xem lúc {fmt(now)} {offset !== 0 && <span className='warn'>(lệch {Math.round(offset / 1000)}s)</span>}
          </span>
        </div>
        <div className='toolbar'>
          <button onClick={() => clock.travelTo(stages[1].start - 5_000)}>5 giây trước giờ G</button>
          <button onClick={() => clock.travelTo(stages[1].end! - 5_000)}>5 giây trước khi hết</button>
          <button onClick={() => clock.travelBy(HOUR)}>+1 giờ</button>
          <button onClick={() => clock.reset()}>Về hiện tại</button>
        </div>
      </div>
    </div>
  );
}

// ---------- Phần 2: tombstone khi xoá khỏi giỏ ----------

const INITIAL: Shipment[] = [
  {
    sellerId: 'bestbuy',
    sellerName: 'Bán bởi Best Buy',
    lineItems: [
      { id: 'a', name: 'Tai nghe chống ồn', price: 299, quantity: 1 },
      { id: 'b', name: 'Cáp USB-C 2m', price: 19, quantity: 2 },
      { id: 'c', name: 'Gói bảo hành 2 năm', price: 49, quantity: 1 },
    ],
  },
  {
    sellerId: 'mkt',
    sellerName: 'Bán bởi Marketplace',
    lineItems: [{ id: 'd', name: 'Ốp lưng trong suốt', price: 12, quantity: 1 }],
  },
];

/** "Server" giả: nhận lệnh xoá, trả về giỏ mới KHÔNG còn dòng đó (và bỏ seller rỗng). */
async function apiRemove(server: Shipment[], id: string): Promise<Shipment[]> {
  await sleep(350);
  return server
    .map((s) => ({ ...s, lineItems: s.lineItems.filter((li) => li.id !== id) }))
    .filter((s) => s.lineItems.length > 0);
}

function Cart({ onLog }: { onLog: (text: string, tone?: 'ok' | 'warn' | 'err' | 'muted') => void }) {
  const [useTombstone, setUseTombstone] = useState(true);
  const [cart, setCart] = useState<Shipment[]>(INITIAL);
  const serverRef = useRef<Shipment[]>(INITIAL);
  const [busy, setBusy] = useState<string | null>(null);

  async function remove(id: string, name: string) {
    setBusy(id);
    const next = await apiRemove(serverRef.current, id);
    serverRef.current = next;
    setCart((prev) => (useTombstone ? mergeTombstones(next, flagRemoved(prev, id)) : next));
    setBusy(null);
    onLog(`Xoá "${name}": server trả ${next.reduce((n, s) => n + s.lineItems.length, 0)} dòng${useTombstone ? ', chèn lại tombstone đúng chỗ' : ''}`, useTombstone ? 'ok' : 'warn');
  }

  function reset() {
    serverRef.current = INITIAL;
    setCart(INITIAL);
  }

  const total = useMemo(() => cartTotal(cart), [cart]);

  return (
    <div className='card ct-cart'>
      <div className='toolbar'>
        <label className='switch'>
          <input
            type='checkbox'
            checked={useTombstone}
            onChange={(e) => {
              setUseTombstone(e.target.checked);
              reset();
            }}
          />
          Dùng tombstone
        </label>
        <button onClick={reset}>Đặt lại giỏ</button>
      </div>
      {cart.length === 0 && <p className='muted'>Giỏ hàng trống.</p>}
      {cart.map((shipment) => (
        <section key={shipment.sellerId} className='ct-shipment'>
          <h3>{shipment.sellerName}</h3>
          {shipment.lineItems.map((li) =>
            li.removed ? (
              <div key={li.id} className='ct-line ct-removed' role='status'>
                ✓ Đã xoá <b>{li.name}</b> khỏi giỏ hàng.
              </div>
            ) : (
              <div key={li.id} className={`ct-line ${busy === li.id ? 'ct-busy' : ''}`}>
                <span className='ct-name'>{li.name}</span>
                <span className='muted'>×{li.quantity}</span>
                <span className='ct-price'>${li.price * li.quantity}</span>
                <button disabled={busy !== null} onClick={() => void remove(li.id, li.name)} aria-label={`Xoá ${li.name}`}>
                  Xoá
                </button>
              </div>
            ),
          )}
        </section>
      ))}
      <div className='ct-total'>
        Tổng: <b>${total}</b>
      </div>
    </div>
  );
}

export default function CountdownTombstoneDemo() {
  const { lines, add } = useLog();
  return (
    <div className='page'>
      <h1>Countdown có time-travel + tombstone giỏ hàng</h1>
      <p className='hint'>
        Banner tự đổi trạng thái theo giờ; QA bấm nút để "du hành" tới đúng thời điểm cần kiểm tra. Bên dưới: xoá một món
        khỏi giỏ, rồi tắt "Dùng tombstone" và xoá lại để so sánh.
      </p>
      <div className='ct-grid'>
        <FlashSale />
        <Cart onLog={add} />
      </div>
      <Log lines={lines} />
    </div>
  );
}

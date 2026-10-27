import { useEffect, useMemo, useRef, useState } from 'react';
import { Log, Stat, useLog } from './shared';
import { watchViewport, type ViewportState } from '../lib/tgMobile';
import { attachLongPress } from '../lib/tgLongPress';
import {
  COUNTRIES,
  detectCountry,
  formatInternational,
  formatNationalLikeOriginal,
  onlyDigits,
  type Country,
} from '../lib/tgPhone';
import './TgMobileDemo.css';

// ---------------------------------------------------------------- 1. khung nhìn

const SCREEN = 640; // chiều cao màn hình máy giả lập (px)
const BAR = 56; // thanh địa chỉ
const KEYBOARD = 280;

type Mode = 'resizes-visual' | 'resizes-content';

function simulate(mode: Mode, barVisible: boolean, keyboardOpen: boolean) {
  const bar = barVisible ? BAR : 0;
  const kb = keyboardOpen ? KEYBOARD : 0;
  // 100vh = khung nhìn LỚN nhất (khi thanh địa chỉ đã thu gọn), không đổi theo bàn phím
  const vh100 = SCREEN;
  // innerHeight: co theo thanh địa chỉ; co theo bàn phím chỉ khi trình duyệt "resizes-content"
  const innerHeight = SCREEN - bar - (mode === 'resizes-content' ? kb : 0);
  // visualViewport.height: luôn là phần thực sự nhìn thấy
  const visible = SCREEN - bar - kb;
  return { bar, kb, visible, apps: { '100vh': vh100, 'var(--vh)': innerHeight, visualViewport: visible } };
}

function PhoneMock({ label, appHeight, bar, kb, visible }: { label: string; appHeight: number; bar: number; kb: number; visible: number }) {
  const scale = 0.32;
  const ok = appHeight <= visible + 0.5;
  return (
    <figure className='tgm-phone'>
      <div className='tgm-screen' style={{ height: SCREEN * scale }}>
        {bar > 0 && <div className='tgm-bar' style={{ height: bar * scale }} />}
        <div className='tgm-app' style={{ top: bar * scale, height: appHeight * scale }}>
          <div className='tgm-msgs' />
          <div className={`tgm-composer ${ok ? 'ok' : 'err'}`}>ô nhập</div>
        </div>
        {kb > 0 && <div className='tgm-kb' style={{ height: kb * scale }}>bàn phím</div>}
      </div>
      <figcaption>
        <code>{label}</code>
        <br />
        cao {appHeight}px · <span className={ok ? 'ok' : 'err'}>{ok ? 'ô nhập thấy được' : 'ô nhập bị che'}</span>
      </figcaption>
    </figure>
  );
}

function ViewportSection() {
  const [live, setLive] = useState<ViewportState | null>(null);
  const [mode, setMode] = useState<Mode>('resizes-visual');
  const [barVisible, setBarVisible] = useState(true);
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => watchViewport({ onChange: setLive }), []);
  const sim = simulate(mode, barVisible, keyboardOpen);

  return (
    <section className='card tgm-section'>
      <h2>1. Chiều cao khung nhìn và bàn phím ảo</h2>
      <p className='hint'>
        Số đo thật của trình duyệt bạn đang dùng (mở trên điện thoại rồi chạm vào ô nhập để thấy bàn phím được phát hiện):
      </p>
      <div className='stats'>
        <Stat label='innerHeight' value={live ? `${live.innerHeight}px` : '—'} />
        <Stat label='visualViewport.height' value={live ? `${Math.round(live.visibleHeight)}px` : '—'} />
        <Stat label='--vh' value={live ? `${(live.innerHeight / 100).toFixed(2)}px` : '—'} />
        <Stat label='layout' value={live ? (live.layout === 'single-column' ? '1 cột' : '2 cột') : '—'} />
        <Stat label='bàn phím' value={live ? (live.keyboardHeight ? `~${Math.round(live.keyboardHeight)}px` : 'đóng') : '—'} />
      </div>
      <input type='text' className='tgm-focus-input' placeholder='Chạm vào đây trên điện thoại để mở bàn phím' />

      <p className='hint' style={{ marginTop: 16 }}>
        Mô phỏng một máy cao {SCREEN}px. Ứng dụng chat cao bằng 3 cách khác nhau, ô nhập nằm ở đáy:
      </p>
      <div className='toolbar' role='group' aria-label='Mô phỏng'>
        <label className='switch'>
          <input type='checkbox' checked={barVisible} onChange={(e) => setBarVisible(e.target.checked)} /> Thanh địa chỉ đang hiện
        </label>
        <label className='switch'>
          <input type='checkbox' checked={keyboardOpen} onChange={(e) => setKeyboardOpen(e.target.checked)} /> Bàn phím đang mở
        </label>
        <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} aria-label='Cách trình duyệt xử lý bàn phím'>
          <option value='resizes-visual'>iOS, Chrome Android ≥ 108 (mặc định)</option>
          <option value='resizes-content'>Android cũ / interactive-widget=resizes-content</option>
        </select>
      </div>
      <div className='tgm-phones'>
        {Object.entries(sim.apps).map(([label, h]) => (
          <PhoneMock key={label} label={label} appHeight={h} bar={sim.bar} kb={sim.kb} visible={sim.visible} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 2. nhấn giữ

const CHATS = ['Mẹ', 'Nhóm lớp 12A', 'Sếp Hùng', 'Giao hàng nhanh'];

function LongPressSection() {
  const listRef = useRef<HTMLUListElement>(null);
  const [tolerance, setTolerance] = useState(10);
  const [allowMouse, setAllowMouse] = useState(true);
  const [menu, setMenu] = useState<{ x: number; y: number; chat: string } | null>(null);
  const { lines, add, clear } = useLog(20);

  useEffect(() => {
    const list = listRef.current!;
    return attachLongPress(list, {
      moveTolerance: tolerance,
      pointerTypes: allowMouse ? ['touch', 'pen', 'mouse'] : ['touch', 'pen'],
      onLongPress: ({ x, y, target }) => {
        const chat = (target as HTMLElement | null)?.closest<HTMLElement>('[data-chat]')?.dataset.chat ?? '?';
        const box = list.getBoundingClientRect();
        setMenu({ x: x - box.left, y: y - box.top, chat });
        add(`giữ đủ 250ms → mở menu cho "${chat}"`, 'ok');
      },
      onCancel: (reason) =>
        add(
          reason === 'move' ? 'tay nhích quá ngưỡng → huỷ' : reason === 'up' ? 'nhấc tay trước 250ms → coi là chạm thường' : 'trình duyệt cuộn trang → huỷ',
          reason === 'move' ? 'warn' : 'muted',
        ),
    });
  }, [tolerance, allowMouse, add]);

  /** Giả lập một ngón tay giữ trên dòng đầu tiên, rung nhẹ `jitter` px rồi nhấc lên sau `hold` ms. */
  const simulateTouch = async (jitter: number, hold: number) => {
    const row = listRef.current!.querySelector<HTMLElement>('[data-chat]')!;
    const rect = row.getBoundingClientRect();
    const x = rect.left + 40;
    const y = rect.top + rect.height / 2;
    const init = { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true };
    row.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x, clientY: y }));
    for (let t = 0; t < hold; t += 50) {
      await new Promise((r) => setTimeout(r, 50));
      row.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x + (t % 100 ? jitter : -jitter), clientY: y }));
    }
    row.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: x, clientY: y }));
    row.click(); // trình duyệt sinh click sau khi nhấc tay
  };

  return (
    <section className='card tgm-section'>
      <h2>2. Nhấn giữ 250ms để mở menu</h2>
      <p className='hint'>
        Chạm thường mở chat, nhấn giữ mở menu. Trên máy tính có thể giữ chuột trái (đã bật để thử). Hoặc dùng nút giả lập
        một ngón tay rung nhẹ 3px khi giữ.
      </p>
      <div className='toolbar'>
        <select value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} aria-label='Ngưỡng rung tay'>
          <option value={0}>Như bản gốc: nhích là huỷ (0px)</option>
          <option value={10}>Cho phép rung 10px</option>
        </select>
        <label className='switch'>
          <input type='checkbox' checked={allowMouse} onChange={(e) => setAllowMouse(e.target.checked)} /> Cho phép giữ chuột
        </label>
        <button onClick={() => simulateTouch(3, 400)}>Giả lập: giữ 400ms, rung 3px</button>
        <button onClick={() => simulateTouch(0, 100)}>Giả lập: chạm nhanh 100ms</button>
        <button onClick={clear}>Xoá log</button>
      </div>
      <div className='tgm-longpress'>
        <div className='tgm-chats-wrap'>
        <ul ref={listRef} className='tgm-chats' onClick={(e) => {
          const chat = (e.target as HTMLElement).closest<HTMLElement>('[data-chat]')?.dataset.chat;
          if (chat) add(`click → mở chat "${chat}"`, 'warn');
        }}>
          {CHATS.map((c) => (
            <li key={c} data-chat={c}>
              <span className='tgm-avatar'>{c[0]}</span>
              {c}
            </li>
          ))}
        </ul>
          {menu && (
            <div className='tgm-menu' style={{ left: Math.min(menu.x, 180), top: menu.y }} role='menu'>
              <b>{menu.chat}</b>
              <button role='menuitem' onClick={() => setMenu(null)}>📌 Ghim</button>
              <button role='menuitem' onClick={() => setMenu(null)}>🔕 Tắt thông báo</button>
              <button role='menuitem' onClick={() => setMenu(null)}>✕ Đóng</button>
            </div>
          )}
        </div>
        <Log lines={lines} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- 3. số điện thoại

const SAMPLES = ['+84912345678', '+12025550123', '+120255501234', '+12645551234', '+77011234567', '+447911123456', '+33612345678'];

function PhoneSection() {
  const [country, setCountry] = useState<Country | undefined>(COUNTRIES.find((c) => c.id === 'VN'));
  const [raw, setRaw] = useState('+84912345678');

  const result = useMemo(() => formatInternational(raw, country), [raw, country]);
  const original = result.country
    ? `+${result.country.code} ${formatNationalLikeOriginal(onlyDigits(raw).slice(result.country.code.length), result.country)}`
    : raw;

  const onInput = (value: string) => {
    let digits = onlyDigits(value);
    // Xoá trúng dấu cách/gạch: chữ số không đổi nên ô nhập "kẹt". Coi như xoá luôn chữ số đứng trước.
    if (value.length < (result.text || raw).length && digits === onlyDigits(raw)) digits = digits.slice(0, -1);
    const detected = detectCountry(digits, country);
    if (detected && detected.id !== country?.id) setCountry(detected);
    setRaw(`+${digits}`);
  };

  return (
    <section className='card tgm-section'>
      <h2>3. Định dạng số điện thoại khi gõ</h2>
      <p className='hint'>Gõ số kèm mã vùng; quốc gia tự nhận theo mã dài nhất khớp. Chọn tay một nước chung mã (+1, +7) thì được giữ nguyên.</p>
      <div className='tgm-phone-row'>
        <select
          value={country?.id ?? ''}
          aria-label='Quốc gia'
          onChange={(e) => {
            const c = COUNTRIES.find((x) => x.id === e.target.value);
            setCountry(c);
            if (c) setRaw(`+${c.code}`);
          }}
        >
          {COUNTRIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.flag} {c.name} +{c.code}
            </option>
          ))}
        </select>
        <input type='text' inputMode='tel' aria-label='Số điện thoại' value={result.text || raw} onChange={(e) => onInput(e.target.value)} />
      </div>
      <div className='toolbar' style={{ marginTop: 8 }}>
        {SAMPLES.map((s) => (
          <button key={s} onClick={() => onInput(s)}>{s}</button>
        ))}
      </div>
      <table className='tgm-table'>
        <tbody>
          <tr>
            <th>Nước nhận ra</th>
            <td>{result.country ? `${result.country.flag} ${result.country.name} (mẫu ${result.country.groups?.join('') ?? 'mặc định 33333'})` : '—'}</td>
          </tr>
          <tr>
            <th>Bản viết lại</th>
            <td>
              <code>{result.text}</code>{' '}
              {result.isComplete && <span className='badge ok'>đủ số</span>}
              {result.overflow > 0 && <span className='badge err'>thừa {result.overflow} số</span>}
            </td>
          </tr>
          <tr>
            <th>Như bản gốc</th>
            <td><code>{original}</code></td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

export default function TgMobileDemo() {
  return (
    <div className='page tgm'>
      <h1>Mobile: --vh, bàn phím ảo, nhấn giữ, số điện thoại</h1>
      <p className='hint'>Ba chi tiết nhỏ giúp Telegram Web A dùng tốt trên điện thoại.</p>
      <ViewportSection />
      <LongPressSection />
      <PhoneSection />
    </div>
  );
}

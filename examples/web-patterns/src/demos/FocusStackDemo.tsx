import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createFocusArbiter, createFocusStack, type RestoreInfo } from '../lib/focusStack';
import { Log, useLog } from './shared';
import './FocusStackDemo.css';

const EVENTS = [
  { id: 'e1', day: 'Thứ 2', title: 'Họp sprint' },
  { id: 'e2', day: 'Thứ 3', title: 'Phỏng vấn ứng viên' },
  { id: 'e3', day: 'Thứ 4', title: '1:1 với lead' },
  { id: 'e4', day: 'Thứ 5', title: 'Demo cho khách' },
];

function describe(el: Element | null): string {
  if (!el) return 'null';
  if (el === document.body) return '<body> (mất focus)';
  const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 28) ?? '';
  return `<${el.tagName.toLowerCase()}> "${label}"`;
}

/** Popup gắn thẳng vào body, tự focus phần tử đầu tiên khi mở, Esc để đóng. */
function Popup({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return createPortal(
    <div
      ref={ref}
      className='fs-popup'
      role='dialog'
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className='fs-popup-title'>{title}</div>
      {children}
    </div>,
    document.body,
  );
}

type Mode = 'none' | 'stack';
type Area = 'compose' | 'list' | 'reading';

export default function FocusStackDemo() {
  const [mode, setMode] = useState<Mode>('stack');
  const [rerender, setRerender] = useState(true);
  const [listVersion, setListVersion] = useState(0);
  const [peek, setPeek] = useState<(typeof EVENTS)[number] | null>(null);
  const [detail, setDetail] = useState<(typeof EVENTS)[number] | null>(null);
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState('');
  const { lines, add } = useLog(16);

  // chế độ "không quản lý": chỉ ghi lại focus rơi về đâu sau khi một popup đóng
  useEffect(() => {
    if (mode !== 'none') return;
    const observer = new MutationObserver((records) => {
      for (const r of records)
        for (const node of Array.from(r.removedNodes))
          if (node instanceof Element && node.classList.contains('fs-popup'))
            setTimeout(() => {
              const lost = document.activeElement === document.body;
              add(
                `Popup "${node.getAttribute('aria-label')}" đóng → focus ở ${describe(document.activeElement)}${lost ? ': phím Esc/Tab tiếp theo không tới được popup nào' : ''}`,
                lost ? 'err' : 'ok',
              );
            }, 0);
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [mode, add]);

  // focus stack chỉ chạy ở chế độ "stack"
  useEffect(() => {
    if (mode !== 'stack') return;
    const stack = createFocusStack({
      onRestore: (info: RestoreInfo) =>
        add(
          `Popup "${info.removed.getAttribute('aria-label') ?? '?'}" đóng → focus về ${describe(info.target)} (${info.via})`,
          info.target ? 'ok' : 'warn',
        ),
    });
    return () => stack.destroy();
  }, [mode, add]);

  // hiển thị phần tử đang giữ focus
  useEffect(() => {
    const update = () => setActive(describe(document.activeElement));
    // focusout chạy TRƯỚC khi focus sang phần tử mới: đọc lại ở tick sau
    const onFocusOut = () => setTimeout(update, 0);
    update();
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    // phần tử đang focus bị gỡ khỏi DOM thì không có focusin/focusout nào: hỏi lại định kỳ
    const id = window.setInterval(update, 300);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
      window.clearInterval(id);
    };
  }, []);

  const openDetailFromPeek = () => {
    // Outlook: mở reading pane từ peek thì peek đóng. Phần tử mở peek là nút trong popup sắp mất.
    setDetail(peek);
    setPeek(null);
    if (rerender) setListVersion((v) => v + 1); // danh sách render lại: nút sự kiện cũ bị thay bằng nút mới
  };

  const closeDetail = () => {
    setDetail(null);
    setMenu(false);
  };

  return (
    <div className='page focus-stack'>
      <h1>Focus stack cho popup lồng nhau</h1>
      <p className='hint'>
        Bấm một sự kiện (hoặc Tab tới rồi Enter) để mở <b>Xem nhanh</b>, trong đó bấm <b>Mở chi tiết</b>: xem nhanh đóng,
        chi tiết mở. Đóng chi tiết (nút hoặc <kbd>Esc</kbd>) rồi xem focus đi đâu.
      </p>
      <div className='toolbar'>
        <button className={mode === 'none' ? 'primary' : ''} onClick={() => setMode('none')}>
          Không quản lý focus
        </button>
        <button className={mode === 'stack' ? 'primary' : ''} onClick={() => setMode('stack')}>
          Focus stack
        </button>
        <label className='switch'>
          <input type='checkbox' checked={rerender} onChange={(e) => setRerender(e.target.checked)} />
          Render lại danh sách khi mở chi tiết
        </label>
      </div>
      <div className='fs-active'>
        Đang focus: <code>{active}</code>
      </div>

      <div className='fs-calendar' key={listVersion}>
        {EVENTS.map((ev) => (
          <div key={ev.id} className='fs-day'>
            <div className='muted'>{ev.day}</div>
            <button data-event-id={ev.id} aria-label={`Sự kiện ${ev.title}`} onClick={() => setPeek(ev)}>
              {ev.title}
            </button>
          </div>
        ))}
      </div>
      <p className='muted fs-version'>Danh sách đã render lại {listVersion} lần</p>

      {peek && (
        <Popup title='Xem nhanh' onClose={() => setPeek(null)}>
          <p>{peek.title}</p>
          <div className='toolbar'>
            <button className='primary' onClick={openDetailFromPeek}>
              Mở chi tiết
            </button>
            <button onClick={() => setPeek(null)}>Đóng</button>
          </div>
        </Popup>
      )}
      {detail && (
        <Popup title='Chi tiết' onClose={closeDetail}>
          <p>
            <b>{detail.title}</b> · {detail.day}, 10:00–11:00
          </p>
          <div className='toolbar'>
            <button onClick={closeDetail}>Đóng chi tiết</button>
            <button onClick={() => setMenu(true)}>Thêm tuỳ chọn…</button>
          </div>
        </Popup>
      )}
      {menu && (
        <Popup title='Tuỳ chọn' onClose={() => setMenu(false)}>
          <div className='toolbar'>
            <button onClick={() => setMenu(false)}>Nhân bản</button>
            <button onClick={() => setMenu(false)}>Đổi màu</button>
          </div>
        </Popup>
      )}

      <Log lines={lines} />
      <Arbiter />
    </div>
  );
}

const AREAS: Array<[Area, string]> = [
  ['compose', 'Soạn thư'],
  ['list', 'Danh sách thư'],
  ['reading', 'Khung đọc'],
];

/** Phần 2: sau khi đóng hộp thoại, vùng nào nên nhận focus? */
function Arbiter() {
  const [arbiter] = useState(() => createFocusArbiter<Area>(['compose', 'list', 'reading']));
  const [enabled, setEnabled] = useState<Record<Area, boolean>>({ compose: false, list: true, reading: true });
  const [result, setResult] = useState('');
  const refs = useRef<Record<Area, HTMLButtonElement | null>>({ compose: null, list: null, reading: null });
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const offs = AREAS.map(([area]) =>
      arbiter.register(area, () => {
        const el = refs.current[area];
        if (!enabledRef.current[area] || !el) return false;
        el.focus();
        return document.activeElement === el;
      }),
    );
    return () => offs.forEach((off) => off());
  }, [arbiter]);

  return (
    <section className='fs-arbiter'>
      <h2>Trọng tài focus theo ưu tiên</h2>
      <p className='hint'>
        Ưu tiên: Soạn thư → Danh sách → Khung đọc. Bỏ chọn một vùng (giả lập vùng đó đang ẩn) rồi bấm "Đóng hộp thoại".
      </p>
      <div className='fs-panes'>
        {AREAS.map(([area, label]) => (
          <div key={area} className='card'>
            <label className='switch'>
              <input
                type='checkbox'
                checked={enabled[area]}
                onChange={(e) => setEnabled((s) => ({ ...s, [area]: e.target.checked }))}
              />
              {label}
            </label>
            <button
              ref={(el) => {
                refs.current[area] = el;
              }}
              disabled={!enabled[area]}
            >
              Ô trong {label.toLowerCase()}
            </button>
          </div>
        ))}
      </div>
      <div className='toolbar'>
        <button
          className='primary'
          onClick={async () => {
            const area = await arbiter.reset();
            setResult(area ? `Focus vào: ${AREAS.find(([a]) => a === area)?.[1]}` : 'Không vùng nào nhận focus');
          }}
        >
          Đóng hộp thoại → resetFocus()
        </button>
        <span className='ok'>{result}</span>
      </div>
    </section>
  );
}

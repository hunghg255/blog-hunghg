import { useEffect, useMemo, useRef, useState } from 'react';
import {
  classifyClick,
  createClickSourceTracker,
  legacyHeuristics,
  readSignature,
  type ClickSignature,
  type ClickSource,
  type Classification,
} from '../lib/virtualCursor';
import { Log, useLog } from './shared';
import './VirtualCursorDemo.css';

const SOURCE_LABEL: Record<ClickSource, string> = {
  mouse: 'chuột',
  touch: 'cảm ứng',
  pen: 'bút',
  keyboard: 'bàn phím',
  assistive: 'trình đọc màn hình / con trỏ ảo',
  programmatic: 'code (element.click / dispatchEvent)',
};

const ITEMS = ['Lưu bài viết', 'Ẩn bài viết', 'Báo cáo'];

export default function VirtualCursorDemo() {
  const { lines, add } = useLog(40);
  const tracker = useMemo(() => createClickSourceTracker(document), []);
  useEffect(() => () => tracker.destroy(), [tracker]);

  const [last, setLast] = useState<{ sig: ClickSignature; result: Classification; legacy: string[] } | null>(
    null,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [smartFocus, setSmartFocus] = useState(true);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openedByRef = useRef<ClickSource | null>(null);

  useEffect(
    () =>
      tracker.subscribe((result, sig, event) => {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('[data-vc-track]')) return;
        setLast({ sig, result, legacy: [...legacyHeuristics(sig)] });
        add(`click từ ${SOURCE_LABEL[result.source]} (${result.reasons[0]})`, result.source === 'mouse' ? 'muted' : 'ok');
      }),
    [tracker, add],
  );

  // Mở menu bằng bàn phím hoặc trình đọc màn hình thì đưa focus vào mục đầu tiên,
  // giống _checkInitialFocus của PopoverMenu. Mở bằng chuột thì để yên.
  useEffect(() => {
    if (!menuOpen) return;
    const source = openedByRef.current;
    const nonPointer = source != null && source !== 'mouse' && source !== 'touch' && source !== 'pen';
    if (smartFocus ? nonPointer : true) firstItemRef.current?.focus();
  }, [menuOpen, smartFocus]);

  // Esc đóng menu dù focus đang ở đâu (mở bằng chuột thì focus vẫn ở nút "Thêm")
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const toggleMenu = () => {
    openedByRef.current = tracker.current()?.source ?? null;
    setMenuOpen((open) => !open);
  };

  const closeMenu = (label?: string) => {
    if (label) add(`chọn "${label}"`, 'muted');
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  // Giả lập click của trình đọc màn hình bằng dispatchEvent: toạ độ 0,0, detail 0.
  // Sự kiện tạo bằng script luôn có isTrusted = false nên bị xếp vào "code"; phần bên
  // dưới chạy lại heuristic như thể isTrusted = true để xem Facebook sẽ đoán gì.
  const simulateVirtualCursor = () => {
    const target = triggerRef.current;
    if (!target) return;
    const fake = new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0, clientX: 0, clientY: 0 });
    const asTrusted: ClickSignature = {
      ...readSignature(fake, { sawMouseDown: true, sawMouseUp: true, keyHeld: null }),
      isTrusted: true,
      offsetX: 0,
      offsetY: 0,
    };
    const result = classifyClick(asTrusted);
    setLast({ sig: asTrusted, result, legacy: [...legacyHeuristics(asTrusted)] });
    add(`giả lập con trỏ ảo → ${SOURCE_LABEL[result.source]}; heuristic FB: ${[...legacyHeuristics(asTrusted)].join(', ') || '(không bắt)'}`, 'warn');
  };

  return (
    <div className='page vc-demo'>
      <h1>Click này từ đâu tới?</h1>
      <p className='hint'>
        Bấm nút "Thêm" bằng chuột, rồi Tab tới nó và nhấn Enter hoặc Space. Với trình đọc màn hình
        (VoiceOver, NVDA, TalkBack), kích hoạt nút cũng cho ra một click không có cú bấm chuột nào.
        Mở menu bằng bàn phím thì focus nhảy vào mục đầu tiên; mở bằng chuột thì không.
      </p>

      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={smartFocus} onChange={(e) => setSmartFocus(e.target.checked)} />
          Chỉ đưa focus vào menu khi không mở bằng chuột
        </label>
        <button onClick={simulateVirtualCursor}>Giả lập click của con trỏ ảo</button>
        <button data-vc-track onClick={() => triggerRef.current?.click()}>
          Gọi element.click()
        </button>
      </div>

      <div className='vc-stage'>
        <div className='vc-post card'>
          <div className='vc-post-head'>
            <span className='vc-avatar' aria-hidden />
            <b>Minh Anh</b>
            <span className='muted'>· 2 giờ</span>
            <span className='vc-spacer' />
            <button
              ref={triggerRef}
              data-vc-track
              className='vc-more'
              aria-haspopup='menu'
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              ⋯ Thêm
            </button>
          </div>
          <p>Cuối tuần này đi Đà Lạt không mọi người?</p>
          {menuOpen && (
            <div className='vc-menu' role='menu'>
              {ITEMS.map((label, i) => (
                <button
                  key={label}
                  ref={i === 0 ? firstItemRef : undefined}
                  role='menuitem'
                  data-vc-track
                  onClick={() => closeMenu(label)}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className='vc-sig card'>
          <b>Chữ ký của click gần nhất</b>
          {last ? (
            <>
              <div className={`badge ${last.result.source === 'mouse' ? '' : 'ok'}`} data-testid='vc-source'>
                {SOURCE_LABEL[last.result.source]}
              </div>
              <ul className='vc-reasons'>
                {last.result.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
              <table>
                <tbody>
                  {(
                    [
                      ['isTrusted', String(last.sig.isTrusted)],
                      ['detail', last.sig.detail],
                      ['pointerType', last.sig.pointerType === undefined ? '(không có)' : `"${last.sig.pointerType}"`],
                      ['clientX, clientY', `${last.sig.clientX}, ${last.sig.clientY}`],
                      ['offsetX, offsetY', `${last.sig.offsetX}, ${last.sig.offsetY}`],
                      ['mousedown / mouseup cùng tick', `${last.sig.sawMouseDown} / ${last.sig.sawMouseUp}`],
                      ['phím đang giữ', last.sig.keyHeld === ' ' ? 'Space' : last.sig.keyHeld ?? '(không)'],
                      ['heuristic của Facebook', last.legacy.join(', ') || '(không bắt)'],
                    ] as const
                  ).map(([k, v]) => (
                    <tr key={k}>
                      <th>{k}</th>
                      <td>{v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className='muted'>Chưa có click nào.</p>
          )}
        </div>
      </div>

      <Log lines={lines} />
    </div>
  );
}

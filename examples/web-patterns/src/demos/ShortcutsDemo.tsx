import { useEffect, useRef, useState } from 'react';
import { Log, useLog } from './shared';
import {
  getTopScope,
  normalizeKey,
  pauseShortcuts,
  resumeShortcuts,
  Scope,
  useShortcut,
} from '../lib/shortcuts';
import './ShortcutsDemo.css';

const CARDS = ['Thiết kế màn đăng nhập', 'Sửa lỗi upload ảnh', 'Viết test cho giỏ hàng', 'Cập nhật tài liệu API', 'Review PR #42'];

const SCOPE_NAMES: Record<number, string> = {
  [Scope.Global]: 'Global',
  [Scope.Page]: 'Page',
  [Scope.Panel]: 'Panel',
  [Scope.Dialog]: 'Dialog',
  [Scope.Popover]: 'Popover',
};

/** Bắn một keydown giả lên phần tử, giống khi người dùng bấm phím trên bàn phím đó. */
function press(target: Element | null, init: KeyboardEventInit) {
  (target ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

export default function ShortcutsDemo() {
  const [naive, setNaive] = useState(false);
  const [selected, setSelected] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [lastKey, setLastKey] = useState('—');
  const [topScope, setTopScope] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { lines, add, clear } = useLog(30);

  const move = (delta: number, via: string) => {
    setSelected((s) => (s + delta + CARDS.length) % CARDS.length);
    add(`${via}: chọn thẻ ${delta > 0 ? 'dưới' : 'trên'}`, 'ok');
  };

  // ---- Cách có scope ----
  useShortcut('j', () => move(1, 'Page j'), { enabled: !naive });
  useShortcut('k', () => move(-1, 'Page k'), { enabled: !naive });
  useShortcut(
    '/',
    () => {
      searchRef.current?.focus();
      add('Page /: focus ô tìm kiếm', 'ok');
    },
    { enabled: !naive },
  );
  useShortcut(
    '?',
    () => {
      setHelpOpen(true);
      add('Page ?: mở dialog trợ giúp', 'ok');
    },
    { enabled: !naive },
  );
  useShortcut(
    'Escape',
    () => {
      setHelpOpen(false);
      add('Dialog Escape: đóng dialog', 'ok');
    },
    { scope: Scope.Dialog, enabled: !naive && helpOpen },
  );
  useShortcut(
    'p',
    () => {
      setPopoverOpen(true);
      add('Dialog p: mở popover', 'ok');
    },
    { scope: Scope.Dialog, enabled: !naive && helpOpen },
  );
  useShortcut(
    'Escape',
    () => {
      setPopoverOpen(false);
      add('Popover Escape: chỉ đóng popover', 'ok');
    },
    { scope: Scope.Popover, enabled: !naive && popoverOpen },
  );
  // Escape trong ô tìm kiếm: bỏ focus để phím tắt chạy lại (Escape được phép khi đang gõ)
  useShortcut(
    'Escape',
    (event) => {
      if (event.target !== searchRef.current) return false;
      searchRef.current?.blur();
      add('Page Escape: rời ô tìm kiếm', 'muted');
    },
    { enabled: !naive },
  );

  // Hiển thị phím đã chuẩn hoá + scope trên cùng (chỉ để minh hoạ)
  useEffect(() => {
    const show = (event: KeyboardEvent) => {
      setLastKey(`key="${event.key}" code="${event.code}" → ${normalizeKey(event)}`);
      setTopScope(getTopScope());
    };
    document.addEventListener('keydown', show, true);
    return () => document.removeEventListener('keydown', show, true);
  }, []);
  useEffect(() => setTopScope(getTopScope()), [naive, helpOpen, popoverOpen]);

  // ---- Cách ngây thơ: một listener trên window, không scope, không kiểm tra gì ----
  useEffect(() => {
    if (!naive) return;
    pauseShortcuts();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'j') move(1, 'naive j');
      if (event.key === 'k') move(-1, 'naive k');
      if (event.key === '?') setHelpOpen(true);
      if (event.key === 'p') setPopoverOpen(true);
      if (event.key === 'Escape') {
        setPopoverOpen(false);
        setHelpOpen(false);
        add('naive Escape: đóng tất cả cùng lúc', 'warn');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      resumeShortcuts();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [naive]);

  const focusTarget = () => (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body);

  return (
    <div className='page shortcuts-demo'>
      <h1>Phím tắt theo phạm vi</h1>
      <p className='hint'>
        Bấm phím thật (j, k, /, ?, p, Esc) hoặc dùng các nút giả lập. Thử: gõ "j" trong ô tìm kiếm, mở dialog rồi bấm j, mở
        popover trong dialog rồi bấm Esc. Bật "Cách ngây thơ" để so sánh.
      </p>

      <div className='toolbar'>
        <label className='switch'>
          <input type='checkbox' checked={naive} onChange={(e) => setNaive(e.target.checked)} /> Cách ngây thơ (listener trên window)
        </label>
        <button onClick={clear}>Xoá log</button>
      </div>

      <div className='toolbar sc-sim' role='group' aria-label='Giả lập bàn phím'>
        <button onClick={() => press(focusTarget(), { key: 'j', code: 'KeyJ' })}>j (QWERTY)</button>
        <button onClick={() => press(focusTarget(), { key: 'о', code: 'KeyJ' })}>о (bàn phím Nga, phím J)</button>
        <button onClick={() => press(focusTarget(), { key: 'ล', code: 'KeyK' })}>ล (bàn phím Thái, phím K)</button>
        <button onClick={() => press(focusTarget(), { key: '？', code: 'Slash', shiftKey: true })}>？ (dấu hỏi toàn khổ)</button>
        <button
          onClick={() => {
            searchRef.current?.focus();
            press(searchRef.current, { key: 'j', code: 'KeyJ' });
          }}
        >
          gõ "j" trong ô tìm kiếm
        </button>
        <button onClick={() => press(focusTarget(), { key: 'j', code: 'KeyJ', isComposing: true })}>j khi đang soạn IME</button>
      </div>

      <div className='stats'>
        <div className='stat'>
          <b className='sc-mono'>{lastKey}</b>
          <span>phím vừa bấm → sau chuẩn hoá</span>
        </div>
        <div className='stat'>
          <b>{naive ? 'không có' : topScope === null ? '—' : SCOPE_NAMES[topScope]}</b>
          <span>scope đang trên cùng</span>
        </div>
      </div>

      <div className='split'>
        <div>
          <input ref={searchRef} type='text' placeholder='Tìm thẻ… (bấm / để focus)' className='sc-search' />
          <ul className='sc-cards' aria-label='Danh sách thẻ'>
            {CARDS.map((card, i) => (
              <li key={card} className={i === selected ? 'card active' : 'card'} aria-current={i === selected}>
                {card}
              </li>
            ))}
          </ul>
          <button onClick={() => setHelpOpen(true)}>Mở dialog trợ giúp (?)</button>
        </div>
        <Log lines={lines} />
      </div>

      {helpOpen && (
        <div className='backdrop'>
          <div className='dialog sc-dialog' role='dialog' aria-modal='true' aria-label='Trợ giúp phím tắt'>
            <h2>Phím tắt</h2>
            <p className='muted'>Dialog đang mở: j/k của trang bên dưới bị chặn. Bấm p để mở popover, Esc để đóng.</p>
            <ul className='sc-help'>
              <li>
                <kbd>j</kbd> <kbd>k</kbd> chọn thẻ
              </li>
              <li>
                <kbd>/</kbd> tìm kiếm
              </li>
              <li>
                <kbd>?</kbd> trợ giúp
              </li>
            </ul>
            <div className='toolbar'>
              <button onClick={() => setPopoverOpen(true)}>Mở popover (p)</button>
              <button onClick={() => setHelpOpen(false)}>Đóng</button>
            </div>
            {popoverOpen && (
              <div className='sc-popover' role='dialog' aria-label='Popover'>
                Popover (scope 130). Esc chỉ đóng cái này.
                <button onClick={() => setPopoverOpen(false)}>×</button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

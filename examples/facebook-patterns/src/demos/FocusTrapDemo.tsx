import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeLayer, useFocusTrap } from '../lib/focusTrap';

function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(ref, true);
  useEscapeLayer(onClose);

  return createPortal(
    <div className='backdrop' onClick={onClose}>
      <div
        ref={ref}
        className='dialog'
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        tabIndex={-1}
        data-focus-trap
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

function useActiveElementLabel() {
  const [label, setLabel] = useState('body');
  useEffect(() => {
    const update = () => {
      const el = document.activeElement as HTMLElement | null;
      setLabel(
        !el || el === document.body
          ? 'body'
          : `<${el.tagName.toLowerCase()}> ${el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 30) ?? ''}`,
      );
    };
    // focusout: khi element bị xoá khỏi DOM, focus rơi về body mà không có focusin
    const onFocusOut = () => setTimeout(update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);
  return label;
}

export default function FocusTrapDemo() {
  const [open, setOpen] = useState(false);
  const [nestedOpen, setNestedOpen] = useState(false);
  const active = useActiveElementLabel();

  return (
    <div className='page'>
      <h1>Focus trap + Esc theo layer</h1>
      <p className='hint'>
        Mở dialog rồi bấm Tab / Shift+Tab: focus chỉ chạy vòng trong dialog. Mở dialog lồng nhau,
        bấm Esc: chỉ dialog trên cùng đóng, và focus quay về đúng nút đã mở nó.
      </p>
      <div className='toolbar'>
        <button>Nút ngoài 1</button>
        <button className='primary' onClick={() => setOpen(true)}>
          Mở dialog
        </button>
        <button>Nút ngoài 2</button>
      </div>
      <div className='stat'>
        <span>Đang focus</span>
        <div>
          <code>{active}</code>
        </div>
      </div>

      {open && (
        <Dialog title='Chỉnh sửa trang cá nhân' onClose={() => setOpen(false)}>
          <input type='text' aria-label='Tên' placeholder='Tên' />
          <input type='email' aria-label='Email' placeholder='Email' />
          <button disabled>Nút disabled (bị bỏ qua)</button>
          <button style={{ display: 'none' }}>Nút ẩn (bị bỏ qua)</button>
          <div className='toolbar' style={{ margin: 0 }}>
            <button onClick={() => setNestedOpen(true)}>Mở dialog xác nhận</button>
            <button onClick={() => setOpen(false)}>Đóng</button>
          </div>
        </Dialog>
      )}

      {nestedOpen && (
        <Dialog title='Bỏ thay đổi?' onClose={() => setNestedOpen(false)}>
          <p className='muted' style={{ margin: 0 }}>
            Esc chỉ đóng dialog này, dialog bên dưới vẫn mở.
          </p>
          <div className='toolbar' style={{ margin: 0 }}>
            <button
              className='primary'
              onClick={() => {
                setNestedOpen(false);
                setOpen(false);
              }}
            >
              Bỏ
            </button>
            <button onClick={() => setNestedOpen(false)}>Tiếp tục sửa</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

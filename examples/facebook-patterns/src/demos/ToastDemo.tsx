import { useEffect, useMemo, useState } from 'react';
import { ToastStore, useToasts, type Toast } from '../lib/toaster';
import { Stat } from './shared';

function Toaster({ store, maxVisible }: { store: ToastStore<string>; maxVisible: number }) {
  const toasts = useToasts(store);
  // Hiện tối đa maxVisible toast, phần còn lại nằm chờ trong store.
  const visible = toasts.slice(0, maxVisible);

  useEffect(() => {
    // báo cho store biết toast nào đã lên màn hình -> store mới bắt đầu đếm giờ
    visible.forEach((t) => !t.shown && store.markShown(t.id));
  }, [visible, store]);

  return (
    <ul className='toaster'>
      {visible.map((t) => (
        <ToastItem key={t.id} toast={t} store={store} />
      ))}
    </ul>
  );
}

function ToastItem({ toast, store }: { toast: Toast<string>; store: ToastStore<string> }) {
  return (
    <li
      className={`toast${toast.expired ? ' expired' : ''}`}
      role='status'
      onPointerEnter={() => store.pause(toast.id)}
      onPointerLeave={() => store.resume(toast.id)}
    >
      <span>{toast.value}</span>
      <button aria-label='Đóng' onClick={() => store.dismiss(toast.id)}>
        ✕
      </button>
      {toast.duration != null && toast.shown && (
        <div
          key={toast.timerVersion}
          className='toast-progress'
          style={{
            animationDuration: `${toast.duration}ms`,
            animationPlayState: toast.paused ? 'paused' : 'running',
          }}
        />
      )}
    </li>
  );
}

let counter = 0;

export default function ToastDemo() {
  const store = useMemo(() => new ToastStore<string>({ maxQueued: 2 }), []);
  const toasts = useToasts(store);
  const [maxVisible, setMaxVisible] = useState(3);

  const push = (text?: string) => store.push(text ?? `Đã lưu bài viết #${++counter}`, 4000);

  return (
    <div className='page'>
      <h1>Toast manager</h1>
      <p className='hint'>
        Hover vào toast để dừng đồng hồ. Bấm "Spam 10 toast": hàng đợi chỉ giữ tối đa 2 toast chưa
        hiện, các toast cũ hơn bị bỏ.
      </p>
      <div className='toolbar'>
        <button className='primary' onClick={() => push()}>
          Push toast
        </button>
        <button
          onClick={() => {
            for (let i = 0; i < 10; i++) setTimeout(() => push(), i * 120);
          }}
        >
          Spam 10 toast
        </button>
        <button onClick={() => store.push('Toast này không tự tắt', null)}>Toast không tự tắt</button>
        <label className='switch'>
          Hiện tối đa
          <select value={maxVisible} onChange={(e) => setMaxVisible(Number(e.target.value))}>
            {[1, 2, 3, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
      </div>
      <div className='stats'>
        <Stat label='đang hiện' value={toasts.filter((t) => t.shown && !t.expired).length} />
        <Stat label='đang chờ' value={toasts.filter((t) => !t.shown).length} />
      </div>
      <Toaster store={store} maxVisible={maxVisible} />
    </div>
  );
}

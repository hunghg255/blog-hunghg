import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DocumentScrollView } from '../lib/documentScrollView';
import { useEscapeLayer } from '../lib/focusTrap';
import './ScrollModalDemo.css';

type Mode = 'facebook' | 'naive';

function useWindowScrollY() {
  const [y, setY] = useState(0);
  useEffect(() => {
    const onScroll = () => setY(Math.round(window.scrollY));
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return y;
}

function Comments({ count, prefix }: { count: number; prefix: string }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className='sm-comment'>
          <b>{prefix} {i + 1}:</b> Bình luận dài để modal cao hơn màn hình, phải cuộn mới đọc hết.
        </div>
      ))}
    </>
  );
}

/** Modal kiểu Facebook: một DocumentScrollView nằm SAU feed trong DOM. */
function FacebookModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeLayer(onClose); // Esc chỉ đóng modal trên cùng (bài #8)
  return (
    <DocumentScrollView>
      <div className='sm-mask' onClick={onClose} />
      <div className='sm-modal-content' onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className='sm-sheet' role='dialog' aria-modal='true' aria-label={title}>
          <div className='sm-sheet-head'>
            <h2>{title}</h2>
            <button onClick={onClose}>Đóng</button>
          </div>
          {children}
        </div>
      </div>
    </DocumentScrollView>
  );
}

/** Cách thường gặp: overlay fixed tự cuộn bên trong + body { overflow: hidden }. */
function NaiveModal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEscapeLayer(onClose);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className='sm-naive' onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className='sm-sheet' role='dialog' aria-modal='true' aria-label={title}>
        <div className='sm-sheet-head'>
          <h2>{title}</h2>
          <button onClick={onClose}>Đóng</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function ScrollModalDemo() {
  const [mode, setMode] = useState<Mode>('facebook');
  const [openPost, setOpenPost] = useState<number | null>(null);
  const [photoOpen, setPhotoOpen] = useState(false);
  const [result, setResult] = useState('');
  const scrollY = useWindowScrollY();
  const openedAt = useRef({ y: 0, width: 0, postTop: 0, id: 0 });

  const postTop = (id: number) =>
    document.getElementById(`sm-post-${id}`)?.getBoundingClientRect().top ?? 0;

  const open = (id: number) => {
    openedAt.current = {
      y: window.scrollY,
      width: document.documentElement.clientWidth,
      postTop: postTop(id),
      id,
    };
    setResult('');
    setOpenPost(id);
  };

  // Đo ngay sau khi mở: trang nền có bị xô ngang không (thanh cuộn biến mất)?
  useEffect(() => {
    if (openPost == null) return;
    const shift = document.documentElement.clientWidth - openedAt.current.width;
    if (shift !== 0) setResult(`Khi mở modal, nội dung trang bị xô ngang ${shift}px (thanh cuộn biến mất).`);
  }, [openPost]);

  const close = () => {
    setPhotoOpen(false);
    setOpenPost(null);
    // đo sau khi React đã commit + trình duyệt đã khôi phục cuộn
    requestAnimationFrame(() => {
      // so vị trí trên màn hình của chính bài viết đã bấm, trước và sau
      const delta = Math.round(postTop(openedAt.current.id) - openedAt.current.postTop);
      setResult((r) =>
        delta === 0
          ? `${r} Đóng modal: bài #${openedAt.current.id} về đúng chỗ cũ ✓`.trim()
          : `${r} Đóng modal: bài #${openedAt.current.id} lệch ${delta}px ✗`.trim(),
      );
    });
  };

  const Modal = mode === 'facebook' ? FacebookModal : NaiveModal;
  const where = openPost == null ? 'feed' : photoOpen ? 'modal ảnh' : 'modal bài viết';

  return (
    <>
      <div className='sm-status' aria-live='polite'>
        window.scrollY = {scrollY}
        <br />
        đang cuộn: {mode === 'facebook' ? where : openPost == null ? 'feed' : 'div trong overlay'}
        {result && (
          <>
            <br />
            <span data-testid='sm-result'>{result}</span>
          </>
        )}
      </div>

      <DocumentScrollView resetScrollOnMount={false}>
        <div className='page'>
          <h1>Modal cuộn bằng chính window</h1>
          <p className='hint'>
            Cuộn xuống giữa feed, mở một bài viết, cuộn hết bình luận, mở thêm ảnh (modal lồng), rồi
            đóng từng cái. Ở chế độ Facebook, cuộn modal là cuộn trang thật (xem window.scrollY), và
            khi đóng thì feed về đúng chỗ cũ.
          </p>
          <div className='toolbar'>
            <label className='switch'>
              <input type='radio' name='sm-mode' checked={mode === 'facebook'} onChange={() => setMode('facebook')} />
              Kiểu Facebook (scroll view stack)
            </label>
            <label className='switch'>
              <input type='radio' name='sm-mode' checked={mode === 'naive'} onChange={() => setMode('naive')} />
              Kiểu thường (body overflow: hidden)
            </label>
          </div>
          {Array.from({ length: 30 }, (_, i) => (
            <article key={i} id={`sm-post-${i + 1}`} className='sm-post'>
              <h3>Bài viết #{i + 1}</h3>
              <button className='primary' onClick={() => open(i + 1)}>
                Mở bài viết #{i + 1}
              </button>
            </article>
          ))}
        </div>
      </DocumentScrollView>

      {openPost != null && (
        <Modal title={`Bài viết #${openPost}`} onClose={close}>
          <p className='muted' style={{ marginTop: 0 }}>
            Modal này cao hơn màn hình. Hãy cuộn tới cuối rồi mở ảnh.
          </p>
          <Comments count={25} prefix='Bình luận' />
          <button className='primary' onClick={() => setPhotoOpen(true)}>
            Mở ảnh (modal lồng)
          </button>
        </Modal>
      )}
      {openPost != null && photoOpen && (
        <Modal title='Ảnh' onClose={() => setPhotoOpen(false)}>
          <div style={{ height: 260, borderRadius: 10, background: 'linear-gradient(135deg,#ffb347,#f2466b)' }} />
          <Comments count={15} prefix='Bình luận ảnh' />
        </Modal>
      )}
    </>
  );
}

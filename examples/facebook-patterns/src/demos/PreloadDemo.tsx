import { Suspense, use, useEffect, useMemo, useRef, useState } from 'react';
import { createResource, lazyWithPreload, usePreloadOnHover } from '../lib/preload';
import { Log, sleep, useLog } from './shared';

interface Profile {
  name: string;
  bio: string;
}

// Mỗi "variant" có chunk + cache riêng để so sánh công bằng.
function createVariant(log: (text: string) => void) {
  const ProfileDialog = lazyWithPreload(async () => {
    log('⬇️  tải chunk JS ProfileDialog…');
    await sleep(600); // giả lập mạng chậm
    return import('./ProfileDialog');
  });
  const profile = createResource<Profile>(async (id) => {
    log(`⬇️  gọi API /users/${id}…`);
    await sleep(700);
    return { name: 'Nguyễn Văn A', bio: 'Frontend engineer, thích đọc mã nguồn người khác.' };
  });
  return { ProfileDialog, profile };
}

type Variant = ReturnType<typeof createVariant>;

function DialogContent({
  variant,
  openedAt,
  onReady,
}: {
  variant: Variant;
  openedAt: number;
  onReady: (ms: number) => void;
}) {
  const data = use(variant.profile.read('42'));
  const { ProfileDialog } = variant;
  const reported = useRef(false);
  useEffect(() => {
    if (reported.current) return;
    reported.current = true;
    onReady(performance.now() - openedAt);
  }, [openedAt, onReady]);
  return <ProfileDialog name={data.name} bio={data.bio} />;
}

function Demo({ title, preload, log }: { title: string; preload: boolean; log: (t: string) => void }) {
  const [resetKey, setResetKey] = useState(0);
  const variant = useMemo(() => createVariant(log), [log, resetKey]);
  const [openedAt, setOpenedAt] = useState<number | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);

  // Tải song song code + data. Gọi lại khi đã có trong cache thì không tốn gì.
  const preloadAll = () => {
    void variant.ProfileDialog.preload();
    variant.profile.preload('42');
  };

  const handlers = usePreloadOnHover(() => {
    log(`👆 [${title}] có ý định bấm -> preload`);
    preloadAll();
  });

  return (
    <div className='card' style={{ display: 'grid', gap: 8 }}>
      <b>{title}</b>
      <div className='toolbar' style={{ margin: 0 }}>
        <button
          className='primary'
          {...(preload ? handlers : {})}
          onClick={() => {
            log(`🖱️ [${title}] click`);
            // cả 2 nút đều bắt đầu tải song song ngay khi click, khác biệt chỉ là
            // nút thứ 2 đã bắt đầu sớm hơn từ lúc hover
            preloadAll();
            setLastMs(null);
            setOpenedAt(performance.now());
          }}
        >
          Xem profile
        </button>
        <button
          onClick={() => {
            setOpenedAt(null);
            setLastMs(null);
            setResetKey((k) => k + 1);
          }}
        >
          Reset cache
        </button>
      </div>
      <div className='muted' style={{ fontSize: 13 }}>
        {lastMs == null ? 'Chưa đo' : `Hiện nội dung sau ${Math.round(lastMs)}ms kể từ lúc click`}
      </div>
      {openedAt != null && (
        <div className='backdrop' onClick={() => setOpenedAt(null)}>
          <div className='dialog' onClick={(e) => e.stopPropagation()}>
            <Suspense
              fallback={
                <div>
                  <span className='spinner' /> Đang tải…
                </div>
              }
            >
              <DialogContent variant={variant} openedAt={openedAt} onReady={setLastMs} />
            </Suspense>
            <button onClick={() => setOpenedAt(null)}>Đóng</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PreloadDemo() {
  const { lines, add } = useLog();
  return (
    <div className='page'>
      <h1>Preload khi hover</h1>
      <p className='hint'>
        Dialog cần 1 chunk JS (600ms) và 1 API (700ms). Rê chuột vào nút một chút rồi mới bấm, so
        sánh thời gian chờ của 2 nút. Trên điện thoại, chạm vào cũng kích hoạt preload.
      </p>
      <div className='split'>
        <div style={{ display: 'grid', gap: 12 }}>
          <Demo title='Không preload' preload={false} log={add} />
          <Demo title='Preload khi hover' preload log={add} />
        </div>
        <aside className='sticky'>
          <Log lines={lines} />
        </aside>
      </div>
    </div>
  );
}

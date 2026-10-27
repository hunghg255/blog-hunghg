import { useMemo, useState } from 'react';
import { createUserActivityMonitor } from '../lib/userActivity';
import { useViewportDuration } from '../lib/useViewportDuration';
import { Log, useLog } from './shared';

// Demo cho inactive sau 5 giây để dễ thử (mặc định thực tế nên khoảng 10–30 giây).
const activityMonitor = createUserActivityMonitor(5000);
const TALL_POST = 6;

function Post({
  index,
  onLog,
  onTotal,
}: {
  index: number;
  onLog: (text: string, tone?: 'ok' | 'muted') => void;
  onTotal: (index: number, ms: number) => void;
}) {
  const [visible, setVisible] = useState(false);
  const ref = useViewportDuration<HTMLElement>({
    threshold: 0.5,
    activityMonitor,
    onVisible: () => {
      setVisible(true);
      onLog(`Post ${index} bắt đầu được nhìn thấy`, 'ok');
    },
    onHidden: ({ visibleDuration, hiddenReason }) => {
      setVisible(false);
      onTotal(index, visibleDuration);
      onLog(`Post ${index} ẩn sau ${(visibleDuration / 1000).toFixed(1)}s — ${hiddenReason}`, 'muted');
    },
  });

  return (
    <article
      ref={ref}
      className={`post${visible ? ' visible' : ''}`}
      // bài số 6 cao gấp ~3 lần viewport: không bao giờ hiện được 50% diện tích
      style={index === TALL_POST ? { minHeight: 1800 } : undefined}
    >
      <h3>
        Bài viết #{index}
        {index === TALL_POST && ' (bài rất dài)'}
      </h3>
      <div className='skeleton' style={{ width: '80%' }} />
      <div className='skeleton' style={{ width: '65%' }} />
      <div className='skeleton' style={{ width: '40%' }} />
    </article>
  );
}

export default function ViewportDurationDemo() {
  const { lines, add } = useLog();
  const [totals, setTotals] = useState<Record<number, number>>({});
  const posts = useMemo(() => Array.from({ length: 15 }, (_, i) => i + 1), []);

  const onTotal = (index: number, ms: number) =>
    setTotals((prev) => ({ ...prev, [index]: (prev[index] ?? 0) + ms }));

  const top = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className='page'>
      <h1>Đo thời gian bài viết thực sự được xem</h1>
      <p className='hint'>
        Cuộn feed, chuyển sang tab khác, hoặc để yên chuột 5 giây rồi xem log: mỗi lần "ẩn" đều có
        lý do. Viền xanh = đang được tính giờ.
      </p>
      <div className='split'>
        <div>
          {posts.map((i) => (
            <Post key={i} index={i} onLog={add} onTotal={onTotal} />
          ))}
        </div>
        <aside className='sticky'>
          <div className='stat' style={{ marginBottom: 8 }}>
            <span>Xem lâu nhất</span>
            {top.length === 0 && <div className='muted'>—</div>}
            {top.map(([index, ms]) => (
              <div key={index}>
                Post {index}: <b style={{ display: 'inline' }}>{(ms / 1000).toFixed(1)}s</b>
              </div>
            ))}
          </div>
          <Log lines={lines} />
        </aside>
      </div>
    </div>
  );
}

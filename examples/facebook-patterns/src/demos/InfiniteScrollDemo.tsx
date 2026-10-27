import { useCallback, useState } from 'react';
import { useInfiniteScroll } from '../lib/useInView';
import { sleep } from './shared';

const PAGE_SIZE = 10;
const MAX_ITEMS = 60;

async function fetchPage(page: number) {
  await sleep(700); // giả lập API chậm
  return Array.from({ length: PAGE_SIZE }, (_, i) => page * PAGE_SIZE + i + 1);
}

export default function InfiniteScrollDemo() {
  const [items, setItems] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState(0);
  const hasMore = items.length < MAX_ITEMS;

  const loadMore = useCallback(async () => {
    setLoading(true);
    setCalls((c) => c + 1);
    const page = await fetchPage(items.length / PAGE_SIZE);
    setItems((prev) => [...prev, ...page]);
    setLoading(false);
  }, [items.length]);

  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    onLoadMore: loadMore,
    hasMore,
    itemCount: items.length,
    rootMargin: '200px',
  });

  return (
    <div className='page'>
      <h1>Infinite scroll bằng sentinel</h1>
      <p className='hint'>
        Cuộn xuống: trang mới được tải khi còn cách cuối danh sách 200px. Số lần gọi API luôn bằng
        số trang, dù sentinel bắn nhiều lần.
      </p>
      <div className='stats'>
        <div className='stat'>
          <b>{items.length}</b>
          <span>item</span>
        </div>
        <div className='stat'>
          <b>{calls}</b>
          <span>lần gọi API</span>
        </div>
      </div>
      {items.map((n) => (
        <div key={n} className='card' style={{ marginBottom: 8 }}>
          Bài viết #{n}
        </div>
      ))}
      {loading && (
        <div className='card' aria-busy>
          <div className='skeleton' style={{ width: '60%' }} />
          <div className='skeleton' />
        </div>
      )}
      {hasMore ? (
        <div ref={sentinelRef} style={{ height: 1 }} />
      ) : (
        <p className='hint' style={{ textAlign: 'center' }}>
          Hết rồi 🎉
        </p>
      )}
    </div>
  );
}

import { useCallback, useState } from 'react';
import { useInfiniteScroll } from '../lib/useInView';
import { sleep } from './shared';

const PAGE_SIZE = 10;
const MAX_ITEMS = 60;

let requestCount = 0;

async function fetchPage(page: number) {
  await sleep(700); // giả lập API chậm
  // cứ lần gọi thứ 3 thì lỗi, để thấy danh sách không bị "kẹt" sau khi API lỗi
  if (++requestCount % 3 === 0) throw new Error('500 Internal Server Error');
  return Array.from({ length: PAGE_SIZE }, (_, i) => page * PAGE_SIZE + i + 1);
}

export default function InfiniteScrollDemo() {
  const [items, setItems] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState(0);
  const [errors, setErrors] = useState(0);
  const hasMore = items.length < MAX_ITEMS;

  const loadMore = useCallback(async () => {
    setLoading(true);
    setCalls((c) => c + 1);
    try {
      const page = await fetchPage(items.length / PAGE_SIZE);
      setItems((prev) => [...prev, ...page]);
    } catch {
      setErrors((c) => c + 1);
      await sleep(1000); // lỗi thì chờ 1 giây rồi mới cho thử lại
    } finally {
      setLoading(false);
    }
  }, [items.length]);

  const sentinelRef = useInfiniteScroll<HTMLDivElement>({
    onLoadMore: loadMore,
    hasMore,
    isLoading: loading,
    rootMargin: '200px',
  });

  return (
    <div className='page'>
      <h1>Infinite scroll bằng sentinel</h1>
      <p className='hint'>
        Cuộn xuống: trang mới được tải khi còn cách cuối danh sách 200px. Cứ lần gọi thứ 3 thì API
        lỗi; danh sách tự thử lại chứ không bị kẹt. Không bao giờ có 2 request chạy song song.
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
        <div className='stat'>
          <b>{errors}</b>
          <span>lần lỗi</span>
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

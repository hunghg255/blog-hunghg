/**
 * Mô phỏng logic CoursePriceStore bản gốc (không phải mã của Udemy), để so sánh trong demo:
 * - `_courseIdsToFetch.sort()` không truyền hàm so sánh, nên id được sắp như chuỗi;
 * - id có trong lô mà response không có thì giữ nguyên trạng thái "loading".
 */
import type { Entry } from '../lib/udPriceLoader';

export function createUdemyStylePriceStore<V>(
  fetchBatch: (ids: number[]) => Promise<Record<number, V>>,
  onChange: () => void,
) {
  const priceMap = new Map<number, Entry<V>>();
  let toFetch: number[] = [];
  let requests = 0;
  const firstUrls: string[] = [];

  function requestInBatches() {
    const sorted = toFetch.sort(); // như bản gốc
    while (sorted.length !== 0) {
      const ids = sorted.splice(0, 10);
      requests++;
      if (firstUrls.length < 3) firstUrls.push(ids.join(','));
      fetchBatch(ids).then(
        (data) => {
          Object.entries(data).forEach(([id, value]) => {
            priceMap.set(parseInt(id, 10), { status: 'loaded', value });
          });
          onChange();
        },
        () => {
          ids.forEach((id) => priceMap.set(id, { ...(priceMap.get(id) ?? {}), status: 'error' }));
          onChange();
        },
      );
    }
  }

  return {
    registerCourse(id: number) {
      const existing = priceMap.get(id);
      if (existing && existing.status !== 'error') return;
      priceMap.set(id, { status: 'loading' });
      onChange();
      if (toFetch.length === 0) {
        toFetch.push(id);
        setTimeout(requestInBatches, 250);
      } else {
        toFetch.push(id);
      }
    },
    get: (id: number) => priceMap.get(id),
    stats: () => ({ requests, firstUrls }),
  };
}

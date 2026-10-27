import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'lru-cache',
  title: 'LRU cache theo 3 cách',
  desc: 'Thứ tự chèn của Map, danh sách liên kết đôi, ghim key đang dùng; kèm cạm bẫy và đo tốc độ (Apple, Similarweb, Outlook)',
  order: 44,
  load: () => import('../LruCacheDemo'),
} satisfies DemoRegistration;

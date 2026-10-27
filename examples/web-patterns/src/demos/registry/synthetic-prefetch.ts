import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'synthetic-prefetch',
  title: 'Warm-up có đánh dấu synthetic, bit flags',
  desc: 'Gọi trước request nhẹ cho group hay mở, gắn header để server không đếm là lượt mở thật; gom nhiều cờ giao diện vào một số nguyên (Outlook)',
  order: 63,
  load: () => import('../SyntheticPrefetchDemo'),
} satisfies DemoRegistration;

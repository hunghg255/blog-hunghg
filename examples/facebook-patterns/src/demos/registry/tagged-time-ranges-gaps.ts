import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'tagged-time-ranges-gaps',
  title: 'Khoảng thời gian gắn nhãn, lỗ buffer',
  desc: 'Interval map [start, end) → chất lượng, so với bản gốc; ba chính sách nhảy qua lỗ buffer',
  order: 94,
  load: () => import('../TaggedRangesDemo'),
} satisfies DemoRegistration;

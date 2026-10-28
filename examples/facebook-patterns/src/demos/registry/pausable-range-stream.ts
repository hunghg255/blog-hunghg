import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'pausable-range-stream',
  title: 'Stream HTTP Range tạm dừng được',
  desc: 'Pause/resume tải tiếp đúng byte, server bỏ qua Range, rớt mạng, gộp segment liền nhau',
  order: 93,
  load: () => import('../PausableRangeDemo'),
} satisfies DemoRegistration;

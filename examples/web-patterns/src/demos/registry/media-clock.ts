import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'media-clock',
  title: 'Đồng hồ media',
  desc: 'Đếm giờ xem chống máy ngủ (Skillshare) + timeline chủ sửa lệch 250ms (Simplified)',
  order: 13,
  load: () => import('../MediaClockDemo'),
} satisfies DemoRegistration;

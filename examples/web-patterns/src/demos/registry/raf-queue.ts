import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'raf-queue',
  title: 'Hàng đợi requestAnimationFrame 3ms',
  desc: 'Gom nhiều việc vào một rAF nhưng chỉ chạy ~3ms mỗi frame, phần còn lại để frame sau (Apple)',
  order: 8,
  load: () => import('../RafQueueDemo'),
} satisfies DemoRegistration;

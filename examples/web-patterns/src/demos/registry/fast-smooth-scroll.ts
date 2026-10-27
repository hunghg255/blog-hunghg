import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'fast-smooth-scroll',
  title: 'fastSmoothScroll: cuộn xa vẫn nhanh',
  desc: 'Nhảy tức thời phần quá xa, chỉ animate 1500px cuối trong 250–600ms (Telegram)',
  order: 6,
  load: () => import('../FastSmoothScrollDemo'),
} satisfies DemoRegistration;

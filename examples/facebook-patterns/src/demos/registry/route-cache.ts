import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'route-cache',
  title: 'Cache route do server phân giải',
  desc: 'Bỏ param tracking, tách cache theo param có nghĩa, chờ route được đẩy trước',
  order: 53,
  load: () => import('../RouteCacheDemo'),
} satisfies DemoRegistration;

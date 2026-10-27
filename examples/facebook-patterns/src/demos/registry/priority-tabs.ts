import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'priority-tabs',
  title: 'Tab "Xem thêm" (priority+)',
  desc: 'float + overflow:hidden + IntersectionObserver, không đo chiều rộng',
  order: 14,
  load: () => import('../PriorityTabsDemo'),
} satisfies DemoRegistration;

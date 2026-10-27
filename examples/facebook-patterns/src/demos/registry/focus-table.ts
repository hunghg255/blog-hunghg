import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'focus-table',
  title: 'Lưới phím 2D và focus không cuộn',
  desc: 'Ô gộp cột, RTL, PageUp/Down, roving tabindex, focus({preventScroll})',
  order: 54,
  load: () => import('../FocusTableDemo'),
} satisfies DemoRegistration;

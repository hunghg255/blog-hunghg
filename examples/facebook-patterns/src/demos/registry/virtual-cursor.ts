import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'virtual-cursor',
  title: 'Click này từ đâu tới?',
  desc: 'Phân biệt click chuột, bàn phím, trình đọc màn hình và element.click()',
  order: 29,
  load: () => import('../VirtualCursorDemo'),
} satisfies DemoRegistration;

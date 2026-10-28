import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'buffer-set',
  title: 'Min/max-heap tái dùng node DOM',
  desc: 'Danh sách ảo 10.000 dòng chỉ dùng vài node, lấy chỗ của dòng xa nhất',
  order: 67,
  load: () => import('../BufferSetDemo'),
} satisfies DemoRegistration;

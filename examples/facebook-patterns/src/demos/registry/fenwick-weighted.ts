import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'fenwick-weighted',
  title: 'Cây tổng: rút thăm theo trọng số',
  desc: 'Chọn ngẫu nhiên có trọng số và tìm dòng ở pixel y trong O(log n)',
  order: 63,
  load: () => import('../FenwickDemo'),
} satisfies DemoRegistration;

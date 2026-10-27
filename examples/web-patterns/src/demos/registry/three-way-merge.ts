import type { DemoRegistration } from '../../demoRegistry';

export default {
  route: 'three-way-merge',
  title: 'Three-way merge ngay trên trình duyệt',
  desc: 'Gộp ba bản base / của tôi / của họ bằng diff3, chỉ hỏi ở chỗ hai bên sửa khác nhau (Postman)',
  order: 42,
  load: () => import('../ThreeWayMergeDemo'),
} satisfies DemoRegistration;
